/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildToolSources, executeToolCall, executeToolCalls, hasToolCalls } from "@workglow/ai";
import type {
  AgentHooks,
  FunctionToolSource,
  RegistryToolSource,
  ToolCall,
  ToolCalls,
  ToolSource,
} from "@workglow/ai";
import { Task, TaskRegistry } from "@workglow/task-graph";
import type { IExecuteContext } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ========================================================================
// Test tasks for registry-based tool sources
// ========================================================================

class TestEchoTask extends Task<{ text: string }, { result: string }> {
  static override readonly type = "TestEchoTask";
  static override readonly category = "Test";
  static override readonly description = "Echoes input text";
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { result: { type: "string" } },
      required: ["result"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  override async execute(input: { text: string }) {
    return { result: input.text };
  }
}

// ========================================================================
// Mock IExecuteContext
// ========================================================================

function createMockContext(aborted = false): IExecuteContext {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return {
    signal: controller.signal,
    updateProgress: vi.fn(),
    own: <T>(task: T) => task,
  } as unknown as IExecuteContext;
}

// ========================================================================
// buildToolSources
// ========================================================================

describe("buildToolSources", () => {
  beforeEach(() => {
    TaskRegistry.registerTask(TestEchoTask);
  });

  afterEach(() => {
    TaskRegistry.all.delete("TestEchoTask");
  });

  test("should build registry tool sources from string task names", () => {
    const sources = buildToolSources(["TestEchoTask"]);

    expect(sources).toHaveLength(1);
    expect(sources[0].type).toBe("registry");
    const registrySource = sources[0] as RegistryToolSource;
    expect(registrySource.taskType).toBe("TestEchoTask");
    expect(registrySource.definition.name).toBe("TestEchoTask");
    expect(registrySource.definition.description).toBe("Echoes input text");
  });

  test("should build function tool sources from tools with executors", () => {
    const executor = vi.fn().mockResolvedValue({ output: "done" });
    const sources = buildToolSources([
      {
        name: "my_tool",
        description: "A custom tool",
        inputSchema: { type: "object", properties: {} },
        execute: executor,
      },
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0].type).toBe("function");
    const fnSource = sources[0] as FunctionToolSource;
    expect(fnSource.definition.name).toBe("my_tool");
    expect(fnSource.run).toBeDefined();
  });

  test("should build function tool sources without executors (throws on run)", async () => {
    const sources = buildToolSources([
      {
        name: "no_exec_tool",
        description: "Tool without executor",
        inputSchema: { type: "object", properties: {} },
      },
    ]);

    expect(sources).toHaveLength(1);
    const fnSource = sources[0] as FunctionToolSource;
    await expect(fnSource.run({})).rejects.toThrow(
      'No executor registered for tool "no_exec_tool"'
    );
  });

  test("should build registry tool source from ToolDefinition with config when task is registered", () => {
    const sources = buildToolSources([
      {
        name: "TestEchoTask",
        description: "Configured echo",
        inputSchema: { type: "object", properties: {} },
        config: { title: "configured" },
      },
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0].type).toBe("registry");
    const registrySource = sources[0] as RegistryToolSource;
    expect(registrySource.taskType).toBe("TestEchoTask");
    expect(registrySource.config).toEqual({ title: "configured" });
  });

  test("should combine string and object tool entries preserving original order", () => {
    const sources = buildToolSources([
      "TestEchoTask",
      {
        name: "fn_tool",
        description: "Function tool",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({}),
      },
    ]);

    expect(sources).toHaveLength(2);
    expect(sources[0].type).toBe("registry");
    expect(sources[1].type).toBe("function");
  });

  test("should preserve order when object entry comes before string entry", () => {
    const sources = buildToolSources([
      {
        name: "fn_tool",
        description: "Function tool",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({}),
      },
      "TestEchoTask",
    ]);

    expect(sources).toHaveLength(2);
    expect(sources[0].type).toBe("function");
    expect(sources[1].type).toBe("registry");
  });

  test("should return empty array when no tools provided", () => {
    const sources = buildToolSources(undefined);
    expect(sources).toHaveLength(0);
  });

  test("should return empty array for empty tools array", () => {
    const sources = buildToolSources([]);
    expect(sources).toHaveLength(0);
  });
});

// ========================================================================
// executeToolCall
// ========================================================================

describe("executeToolCall", () => {
  test("should execute a function tool source", async () => {
    const executor = vi.fn().mockResolvedValue({ value: 42 });
    const sources: ToolSource[] = [
      {
        type: "function",
        definition: { name: "calc", description: "Calculate", inputSchema: { type: "object" } },
        run: executor,
      },
    ];
    const call: ToolCall = { id: "call_1", name: "calc", input: { x: 10 } };
    const context = createMockContext();

    const result = await executeToolCall(call, sources, context);

    expect(result.toolCallId).toBe("call_1");
    expect(result.toolName).toBe("calc");
    expect(result.output).toEqual({ value: 42 });
    expect(result.isError).toBe(false);
    expect(executor).toHaveBeenCalledWith({ x: 10 });
  });

  test("should return error for unknown tool", async () => {
    const sources: ToolSource[] = [];
    const call: ToolCall = { id: "call_1", name: "unknown", input: {} };
    const context = createMockContext();

    const result = await executeToolCall(call, sources, context);

    expect(result.isError).toBe(true);
    expect(result.output).toEqual({ error: "Unknown tool: unknown" });
  });

  test("should return error when tool execution fails", async () => {
    const sources: ToolSource[] = [
      {
        type: "function",
        definition: { name: "broken", description: "Broken", inputSchema: { type: "object" } },
        run: async () => {
          throw new Error("Tool crashed");
        },
      },
    ];
    const call: ToolCall = { id: "call_1", name: "broken", input: {} };
    const context = createMockContext();

    const result = await executeToolCall(call, sources, context);

    expect(result.isError).toBe(true);
    expect(result.output).toEqual({ error: "Tool crashed" });
  });

  // ====================================================================
  // Hook tests
  // ====================================================================

  test("beforeToolCall hook — deny", async () => {
    const sources: ToolSource[] = [
      {
        type: "function",
        definition: { name: "tool", description: "Tool", inputSchema: { type: "object" } },
        run: vi.fn(),
      },
    ];
    const call: ToolCall = { id: "call_1", name: "tool", input: {} };
    const hooks: AgentHooks = {
      beforeToolCall: async () => ({ action: "deny", reason: "Not allowed" }),
    };
    const context = createMockContext();

    const result = await executeToolCall(call, sources, context, hooks);

    expect(result.isError).toBe(true);
    expect(result.output).toEqual({ error: "Not allowed" });
    expect((sources[0] as FunctionToolSource).run).not.toHaveBeenCalled();
  });

  test("beforeToolCall hook — modify input", async () => {
    const executor = vi.fn().mockResolvedValue({ done: true });
    const sources: ToolSource[] = [
      {
        type: "function",
        definition: { name: "tool", description: "Tool", inputSchema: { type: "object" } },
        run: executor,
      },
    ];
    const call: ToolCall = { id: "call_1", name: "tool", input: { original: true } };
    const hooks: AgentHooks = {
      beforeToolCall: async () => ({ action: "modify", input: { modified: true } }),
    };
    const context = createMockContext();

    await executeToolCall(call, sources, context, hooks);

    expect(executor).toHaveBeenCalledWith({ modified: true });
  });

  test("afterToolCall hook — transform result", async () => {
    const sources: ToolSource[] = [
      {
        type: "function",
        definition: { name: "tool", description: "Tool", inputSchema: { type: "object" } },
        run: async () => ({ raw: true }),
      },
    ];
    const call: ToolCall = { id: "call_1", name: "tool", input: {} };
    const hooks: AgentHooks = {
      afterToolCall: async (_call, result) => ({
        ...result,
        output: { ...result.output, enriched: true },
      }),
    };
    const context = createMockContext();

    const result = await executeToolCall(call, sources, context, hooks);

    expect(result.output).toEqual({ raw: true, enriched: true });
  });

  test("onToolError hook — provide fallback result", async () => {
    const sources: ToolSource[] = [
      {
        type: "function",
        definition: { name: "tool", description: "Tool", inputSchema: { type: "object" } },
        run: async () => {
          throw new Error("boom");
        },
      },
    ];
    const call: ToolCall = { id: "call_1", name: "tool", input: {} };
    const hooks: AgentHooks = {
      onToolError: async () => ({ action: "result", output: { fallback: true } }),
    };
    const context = createMockContext();

    const result = await executeToolCall(call, sources, context, hooks);

    expect(result.isError).toBe(false);
    expect(result.output).toEqual({ fallback: true });
  });

  test("onToolError hook — re-throw (default behavior)", async () => {
    const sources: ToolSource[] = [
      {
        type: "function",
        definition: { name: "tool", description: "Tool", inputSchema: { type: "object" } },
        run: async () => {
          throw new Error("boom");
        },
      },
    ];
    const call: ToolCall = { id: "call_1", name: "tool", input: {} };
    const hooks: AgentHooks = {
      onToolError: async () => ({ action: "throw" }),
    };
    const context = createMockContext();

    const result = await executeToolCall(call, sources, context, hooks);

    expect(result.isError).toBe(true);
    expect(result.output).toEqual({ error: "boom" });
  });
});

// ========================================================================
// executeToolCalls (concurrent execution)
// ========================================================================

describe("executeToolCalls", () => {
  test("should execute multiple tool calls and return results in order", async () => {
    const sources: ToolSource[] = [
      {
        type: "function",
        definition: { name: "a", description: "A", inputSchema: { type: "object" } },
        run: async (input) => ({ got: input }),
      },
      {
        type: "function",
        definition: { name: "b", description: "B", inputSchema: { type: "object" } },
        run: async (input) => ({ got: input }),
      },
    ];

    const toolCalls: ToolCalls = [
      { id: "call_0", name: "a", input: { x: 1 } },
      { id: "call_1", name: "b", input: { y: 2 } },
    ];
    const context = createMockContext();

    const results = await executeToolCalls(toolCalls, sources, context);

    expect(results).toHaveLength(2);
    expect(results[0].toolName).toBe("a");
    expect(results[0].output).toEqual({ got: { x: 1 } });
    expect(results[1].toolName).toBe("b");
    expect(results[1].output).toEqual({ got: { y: 2 } });
  });

  test("should return empty array for empty toolCalls", async () => {
    const context = createMockContext();
    const results = await executeToolCalls([], [], context);
    expect(results).toHaveLength(0);
  });

  test("should respect maxConcurrency", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const sources: ToolSource[] = [
      {
        type: "function",
        definition: { name: "slow", description: "Slow", inputSchema: { type: "object" } },
        run: async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 10));
          concurrent--;
          return { done: true };
        },
      },
    ];

    const toolCalls: ToolCalls = [];
    for (let i = 0; i < 6; i++) {
      toolCalls.push({ id: `call_${i}`, name: "slow", input: {} });
    }
    const context = createMockContext();

    const results = await executeToolCalls(toolCalls, sources, context, undefined, 2);

    expect(results).toHaveLength(6);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  test("should abort on signal", async () => {
    const controller = new AbortController();
    const context = {
      signal: controller.signal,
      updateProgress: vi.fn(),
      own: <T>(task: T) => task,
    } as unknown as IExecuteContext;

    let callCount = 0;
    const sources: ToolSource[] = [
      {
        type: "function",
        definition: { name: "tool", description: "Tool", inputSchema: { type: "object" } },
        run: async () => {
          callCount++;
          if (callCount === 1) controller.abort();
          return { done: true };
        },
      },
    ];

    const toolCalls: ToolCalls = [
      { id: "call_0", name: "tool", input: {} },
      { id: "call_1", name: "tool", input: {} },
      { id: "call_2", name: "tool", input: {} },
    ];

    await expect(executeToolCalls(toolCalls, sources, context, undefined, 1)).rejects.toThrow();
  });
});

// ========================================================================
// hasToolCalls
// ========================================================================

describe("hasToolCalls", () => {
  test("should return true when toolCalls has entries", () => {
    expect(hasToolCalls([{ id: "call_0", name: "test", input: {} }])).toBe(true);
  });

  test("should return false for empty array", () => {
    expect(hasToolCalls([])).toBe(false);
  });

  test("should return false for undefined", () => {
    expect(hasToolCalls(undefined)).toBe(false);
  });
});
