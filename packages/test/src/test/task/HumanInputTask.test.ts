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
  type IHumanConnector,
  type IHumanRequest,
  type IHumanResponse,
} from "@workglow/tasks";
import { Container, globalServiceRegistry, ServiceRegistry } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeEach, describe, expect, test, vi } from "vitest";

// ========================================================================
// Mock connector
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

  test("single mode: returns human response data as output", async () => {
    const responseSchema: DataPortSchema = {
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: false,
    };

    const connector = createMockConnector((req) => ({
      requestId: req.requestId,
      data: { name: "Alice" },
      done: true,
    }));

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanInputTask(
      {},
      { schema: responseSchema, title: "What is your name?" }
    );
    const result = await task.run({}, { registry });

    expect(result).toEqual({ name: "Alice" });
    expect(connector.request).toHaveBeenCalledOnce();
  });

  test("merges input prompt into message", async () => {
    const connector = createMockConnector((req) => {
      expect(req.message).toBe("Base message\n\nDynamic prompt");
      return { requestId: req.requestId, data: { ok: true }, done: true };
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
      return { requestId: req.requestId, data: {}, done: true };
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
      return { requestId: req.requestId, data: {}, done: true };
    });

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanInputTask({}, {});
    await task.run({}, { registry });
  });

  test("uses custom targetHumanId from config", async () => {
    const connector = createMockConnector((req) => {
      expect(req.targetHumanId).toBe("admin");
      return { requestId: req.requestId, data: {}, done: true };
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
      { requestId: "r1", data: { step: 1 }, done: false },
      { requestId: "r1", data: { step: 2 }, done: false },
      { requestId: "r1", data: { step: 3, final: true }, done: true },
    ]);

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanInputTask({}, { mode: "multi-turn" });
    const result = await task.run({}, { registry });

    expect(result).toEqual({ step: 3, final: true });
    expect(connector.request).toHaveBeenCalledOnce();
    expect(connector.followUp).toHaveBeenCalledTimes(2);
  });

  test("multi-turn mode: throws if connector has no followUp", async () => {
    const connector = createMockConnector((req) => ({
      requestId: req.requestId,
      data: {},
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
          // Simulate long wait — abort fires before this resolves
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

  test("dynamic output schema comes from config.schema", () => {
    const schema: DataPortSchema = {
      type: "object",
      properties: { color: { type: "string" } },
      additionalProperties: false,
    };

    const task = new HumanInputTask({}, { schema });
    expect(task.outputSchema()).toEqual(schema);
  });

  test("output flows to downstream task via dataflow", async () => {
    const connector = createMockConnector((req) => ({
      requestId: req.requestId,
      data: { text: "hello" },
      done: true,
    }));

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const humanTask = new HumanInputTask(
      {},
      {
        schema: {
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

  test("returns approved=true", async () => {
    const connector = createMockConnector((req) => ({
      requestId: req.requestId,
      data: { approved: true, reason: "Looks good" },
      done: true,
    }));

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanApprovalTask(
      {},
      { title: "Deploy to production?", message: "3 files changed" }
    );
    const result = await task.run({}, { registry });

    expect(result).toEqual({ approved: true, reason: "Looks good" });
    expect(task.status).toBe(TaskStatus.COMPLETED);
  });

  test("returns approved=false with reason", async () => {
    const connector = createMockConnector((req) => ({
      requestId: req.requestId,
      data: { approved: false, reason: "Not ready" },
      done: true,
    }));

    registry.registerInstance(HUMAN_CONNECTOR, connector);

    const task = new HumanApprovalTask({}, { title: "Approve?" });
    const result = await task.run({}, { registry });

    expect(result).toEqual({ approved: false, reason: "Not ready" });
  });

  test("has fixed output schema for approved/reason", () => {
    const task = new HumanApprovalTask({}, {});
    const schema = task.outputSchema();
    expect(schema.properties).toHaveProperty("approved");
    expect(schema.properties).toHaveProperty("reason");
    expect(schema.required).toContain("approved");
  });

  test("always uses single mode", async () => {
    const connector = createMockConnector((req) => {
      expect(req.mode).toBe("single");
      return { requestId: req.requestId, data: { approved: true }, done: true };
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

describe("Workflow integration", () => {
  test("humanInput method exists on Workflow prototype", () => {
    expect(typeof Workflow.prototype.humanInput).toBe("function");
  });

  test("humanApproval method exists on Workflow prototype", () => {
    expect(typeof Workflow.prototype.humanApproval).toBe("function");
  });
});
