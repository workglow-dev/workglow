/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Dataflow,
  Task,
  TaskConfigurationError,
  TaskGraph,
  TaskStatus,
  Workflow,
} from "@workglow/task-graph";
import {
  HUMAN_CONNECTOR,
  HumanApprovalTask,
  HumanInputTask,
  McpElicitationConnector,
  type IHumanConnector,
  type IHumanRequest,
  type IHumanResponse,
} from "@workglow/tasks";
import { Container, globalServiceRegistry, ServiceRegistry } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeEach, describe, expect, test, vi } from "vitest";

// ========================================================================
// Mock connector (mimics MCP elicitation semantics)
// ========================================================================

function createMockConnector(
  handler: (request: IHumanRequest) => IHumanResponse
): IHumanConnector {
  return {
    request: vi.fn(async (request: IHumanRequest, _signal: AbortSignal) => handler(request)),
  };
}

function createMultiTurnConnector(
  responses: IHumanResponse[]
): IHumanConnector & { followUp: NonNullable<IHumanConnector["followUp"]> } {
  let callIndex = 0;
  return {
    request: vi.fn(async () => responses[callIndex++]!),
    followUp: vi.fn(async () => responses[callIndex++]!),
  };
}

// ========================================================================
// Helper task for dataflow tests
// ========================================================================

class UpperCaseTask extends Task<{ text: string }, { text: string }> {
  public static override type = "HumanTest_UpperCaseTask";
  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  override async execute(input: { text: string }) {
    return { text: input.text.toUpperCase() };
  }
}

// ========================================================================
// Tests
// ========================================================================

describe("HumanInputTask", () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    registry = globalServiceRegistry;
  });

  test("single mode: returns human response data with action as output", async () => {
    const requestedSchema: DataPortSchema = {
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: false,
    };

    const connector = createMockConnector((req) => ({
      requestId: req.requestId,
      action: "accept",
      content: { name: "Alice" },
      done: true,
    }));

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanInputTask(
      {},
      { requestedSchema, message: "What is your name?" }
    );
    const result = await task.run({}, { registry });

    expect(result).toEqual({ action: "accept", name: "Alice" });
    expect(connector.request).toHaveBeenCalledOnce();
  });

  test("decline action returns action without content", async () => {
    const connector = createMockConnector((req) => ({
      requestId: req.requestId,
      action: "decline",
      content: undefined,
      done: true,
    }));

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanInputTask({}, {});
    const result = await task.run({}, { registry });

    expect(result).toEqual({ action: "decline" });
  });

  test("cancel action returns action without content", async () => {
    const connector = createMockConnector((req) => ({
      requestId: req.requestId,
      action: "cancel",
      content: undefined,
      done: true,
    }));

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanInputTask({}, {});
    const result = await task.run({}, { registry });

    expect(result).toEqual({ action: "cancel" });
  });

  test("merges input prompt into message", async () => {
    const connector = createMockConnector((req) => {
      expect(req.message).toBe("Base message\n\nDynamic prompt");
      return { requestId: req.requestId, action: "accept", content: { ok: true }, done: true };
    });

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanInputTask(
      { prompt: "Dynamic prompt" },
      { message: "Base message" }
    );
    await task.run({}, { registry });
    expect(connector.request).toHaveBeenCalledOnce();
  });

  test("merges input context into metadata", async () => {
    const connector = createMockConnector((req) => {
      expect(req.metadata).toEqual({ source: "test", extra: "data" });
      return { requestId: req.requestId, action: "accept", content: {}, done: true };
    });

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanInputTask(
      { context: { extra: "data" } },
      { metadata: { source: "test" } }
    );
    await task.run({}, { registry });
  });

  test("defaults targetHumanId to 'default'", async () => {
    const connector = createMockConnector((req) => {
      expect(req.targetHumanId).toBe("default");
      return { requestId: req.requestId, action: "accept", content: {}, done: true };
    });

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanInputTask({}, {});
    await task.run({}, { registry });
  });

  test("uses custom targetHumanId from config", async () => {
    const connector = createMockConnector((req) => {
      expect(req.targetHumanId).toBe("admin");
      return { requestId: req.requestId, action: "accept", content: {}, done: true };
    });

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanInputTask({}, { targetHumanId: "admin" });
    await task.run({}, { registry });
  });

  test("throws when no IHumanConnector is registered", async () => {
    // Use a fresh container with no connector registered
    const emptyRegistry = new ServiceRegistry(new Container());

    const task = new HumanInputTask({}, {});
    await expect(task.run({}, { registry: emptyRegistry })).rejects.toThrow(
      TaskConfigurationError
    );
  });

  test("multi-turn mode: loops until done=true", async () => {
    const connector = createMultiTurnConnector([
      { requestId: "r1", action: "accept", content: { step: 1 }, done: false },
      { requestId: "r1", action: "accept", content: { step: 2 }, done: false },
      { requestId: "r1", action: "accept", content: { step: 3, final: true }, done: true },
    ]);

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanInputTask({}, { mode: "multi-turn" });
    const result = await task.run({}, { registry });

    expect(result).toEqual({ action: "accept", step: 3, final: true });
    expect(connector.request).toHaveBeenCalledOnce();
    expect(connector.followUp).toHaveBeenCalledTimes(2);
  });

  test("multi-turn mode: throws if connector has no followUp", async () => {
    const connector = createMockConnector((req) => ({
      requestId: req.requestId,
      action: "accept",
      content: {},
      done: false, // not done, but connector has no followUp
    }));

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanInputTask({}, { mode: "multi-turn" });
    await expect(task.run({}, { registry })).rejects.toThrow(TaskConfigurationError);
  });

  test("respects abort signal", async () => {
    const abortController = new AbortController();

    const connector: IHumanConnector = {
      request: vi.fn(async (_req, signal: AbortSignal) => {
        return new Promise<IHumanResponse>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }),
    };

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanInputTask({}, {});
    const runPromise = task.run({}, { registry, signal: abortController.signal });

    // Abort shortly after
    setTimeout(() => abortController.abort(), 10);

    await expect(runPromise).rejects.toThrow();
  });

  test("dynamic output schema includes action and config schema properties", () => {
    const requestedSchema: DataPortSchema = {
      type: "object",
      properties: { color: { type: "string" } },
      additionalProperties: false,
    };

    const task = new HumanInputTask({}, { requestedSchema });
    const schema = task.outputSchema();
    expect(schema.properties).toHaveProperty("action");
    expect(schema.properties).toHaveProperty("color");
  });

  test("request passes requestedSchema to connector", async () => {
    const requestedSchema: DataPortSchema = {
      type: "object",
      properties: { email: { type: "string", format: "email" } },
      required: ["email"],
    };

    const connector = createMockConnector((req) => {
      expect(req.requestedSchema).toEqual(requestedSchema);
      return { requestId: req.requestId, action: "accept", content: { email: "a@b.c" }, done: true };
    });

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanInputTask({}, { requestedSchema, message: "Enter email" });
    await task.run({}, { registry });
  });

  test("output flows to downstream task via dataflow", async () => {
    const connector = createMockConnector((req) => ({
      requestId: req.requestId,
      action: "accept",
      content: { text: "hello" },
      done: true,
    }));

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const humanTask = new HumanInputTask(
      {},
      {
        requestedSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          additionalProperties: false,
        },
      }
    );
    const upperTask = new UpperCaseTask({});

    const graph = new TaskGraph();
    graph.addTask(humanTask);
    graph.addTask(upperTask);
    graph.addDataflow(
      new Dataflow(humanTask.id, "text", upperTask.id, "text")
    );

    const result = await graph.run({}, { registry });
    expect(result).toBeInstanceOf(Array);
    expect(result[0].data).toEqual({ text: "HELLO" });
  });
});

describe("HumanApprovalTask", () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    registry = globalServiceRegistry;
  });

  test("returns approved=true when human accepts with approved=true", async () => {
    const connector = createMockConnector((req) => ({
      requestId: req.requestId,
      action: "accept",
      content: { approved: true, reason: "Looks good" },
      done: true,
    }));

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanApprovalTask(
      {},
      { message: "Deploy to production?" }
    );
    const result = await task.run({}, { registry });

    expect(result).toEqual({ action: "accept", approved: true, reason: "Looks good" });
    expect(task.status).toBe(TaskStatus.COMPLETED);
  });

  test("returns approved=false when human accepts with approved=false", async () => {
    const connector = createMockConnector((req) => ({
      requestId: req.requestId,
      action: "accept",
      content: { approved: false, reason: "Not ready" },
      done: true,
    }));

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanApprovalTask({}, { message: "Approve?" });
    const result = await task.run({}, { registry });

    expect(result).toEqual({ action: "accept", approved: false, reason: "Not ready" });
  });

  test("returns approved=false when human declines at MCP level", async () => {
    const connector = createMockConnector((req) => ({
      requestId: req.requestId,
      action: "decline",
      content: undefined,
      done: true,
    }));

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanApprovalTask({}, {});
    const result = await task.run({}, { registry });

    expect(result.action).toBe("decline");
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("Declined by user");
  });

  test("returns approved=false when human cancels at MCP level", async () => {
    const connector = createMockConnector((req) => ({
      requestId: req.requestId,
      action: "cancel",
      content: undefined,
      done: true,
    }));

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanApprovalTask({}, {});
    const result = await task.run({}, { registry });

    expect(result.action).toBe("cancel");
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("Cancelled by user");
  });

  test("has output schema with action, approved, and reason", () => {
    const task = new HumanApprovalTask({}, {});
    const schema = (task.constructor as typeof HumanApprovalTask).outputSchema();
    expect(schema.properties).toHaveProperty("action");
    expect(schema.properties).toHaveProperty("approved");
    expect(schema.properties).toHaveProperty("reason");
    expect(schema.required).toContain("action");
    expect(schema.required).toContain("approved");
  });

  test("always uses single mode", async () => {
    const connector = createMockConnector((req) => {
      expect(req.mode).toBe("single");
      return { requestId: req.requestId, action: "accept", content: { approved: true }, done: true };
    });

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanApprovalTask({}, {});
    await task.run({}, { registry });
  });

  test("static type is correct", () => {
    expect(HumanApprovalTask.type).toBe("HumanApprovalTask");
    expect(HumanApprovalTask.category).toBe("Flow Control");
  });
});

describe("McpElicitationConnector", () => {
  test("converts IHumanRequest to MCP elicitInput call", async () => {
    const mockElicitInput = vi.fn().mockResolvedValue({
      action: "accept",
      content: { username: "alice" },
    });

    const mockServer = { elicitInput: mockElicitInput } as any;
    const connector = new McpElicitationConnector(mockServer);

    const request: IHumanRequest = {
      requestId: "req-1",
      targetHumanId: "default",
      requestedSchema: {
        type: "object",
        properties: { username: { type: "string" } },
        required: ["username"],
      },
      message: "Enter your username",
      mode: "single",
      metadata: undefined,
    };

    const response = await connector.request(request, new AbortController().signal);

    expect(mockElicitInput).toHaveBeenCalledOnce();
    const [params] = mockElicitInput.mock.calls[0];
    expect(params.mode).toBe("form");
    expect(params.message).toBe("Enter your username");
    expect(params.requestedSchema.properties).toHaveProperty("username");
    expect(params.requestedSchema.required).toEqual(["username"]);

    expect(response.requestId).toBe("req-1");
    expect(response.action).toBe("accept");
    expect(response.content).toEqual({ username: "alice" });
    expect(response.done).toBe(true);
  });

  test("maps MCP decline to IHumanResponse", async () => {
    const mockServer = {
      elicitInput: vi.fn().mockResolvedValue({ action: "decline" }),
    } as any;

    const connector = new McpElicitationConnector(mockServer);
    const response = await connector.request(
      {
        requestId: "req-2",
        targetHumanId: "default",
        requestedSchema: { type: "object", properties: {} },
        message: "Confirm?",
        mode: "single",
        metadata: undefined,
      },
      new AbortController().signal
    );

    expect(response.action).toBe("decline");
    expect(response.content).toBeUndefined();
    expect(response.done).toBe(true);
  });

  test("followUp delegates to another elicitInput call", async () => {
    const mockServer = {
      elicitInput: vi.fn()
        .mockResolvedValueOnce({ action: "accept", content: { step: 1 } })
        .mockResolvedValueOnce({ action: "accept", content: { step: 2 } }),
    } as any;

    const connector = new McpElicitationConnector(mockServer);
    const request: IHumanRequest = {
      requestId: "req-3",
      targetHumanId: "default",
      requestedSchema: { type: "object", properties: {} },
      message: "Continue?",
      mode: "multi-turn",
      metadata: undefined,
    };

    const first = await connector.request(request, new AbortController().signal);
    const second = await connector.followUp(request, first, new AbortController().signal);

    expect(mockServer.elicitInput).toHaveBeenCalledTimes(2);
    expect(second.content).toEqual({ step: 2 });
  });
});

describe("Workflow integration", () => {
  test("humanInput method exists on Workflow prototype", () => {
    expect(typeof Workflow.prototype.humanInput).toBe("function");
  });

  test("humanApproval method exists on Workflow prototype", () => {
    expect(typeof Workflow.prototype.humanApproval).toBe("function");
  });
});
