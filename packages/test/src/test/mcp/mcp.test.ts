/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  mcpClientFactory,
  McpListTask,
  McpPromptGetTask,
  McpResourceReadTask,
  McpToolCallTask,
} from "@workglow/tasks";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

function fn() {
  const calls: unknown[][] = [];
  const mock = (...args: unknown[]) => {
    calls.push(args);
    return mock._result;
  };
  mock.calls = calls;
  mock._result = undefined as unknown;
  mock.mockResolvedValue = (val: unknown) => {
    mock._result = Promise.resolve(val);
    return mock;
  };
  mock.mockRejectedValue = (val: unknown) => {
    mock._result = Promise.reject(val);
    return mock;
  };
  return mock;
}

function createMockClient(overrides: Record<string, unknown> = {}) {
  return {
    callTool: fn(),
    readResource: fn(),
    getPrompt: fn(),
    listTools: fn(),
    listResources: fn(),
    listPrompts: fn(),
    close: fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const originalCreate = mcpClientFactory.create;

const baseInput = { transport: "stdio" as const, command: "test-server" };

function mockFactory(mockClient: ReturnType<typeof createMockClient>) {
  mcpClientFactory.create = (() =>
    Promise.resolve({
      client: mockClient,
      transport: {},
    })) as unknown as typeof mcpClientFactory.create;
}

beforeEach(() => {
  mcpClientFactory.create = originalCreate;
});

afterEach(() => {
  mcpClientFactory.create = originalCreate;
});

describe("McpToolCallTask", () => {
  test("calls a tool and returns content", async () => {
    const mockClient = createMockClient({
      callTool: fn().mockResolvedValue({
        content: [{ type: "text", text: "hello" }],
        isError: false,
      }),
    });
    mockFactory(mockClient);

    const task = new McpToolCallTask();
    const result = await task.run({
      ...baseInput,
      tool_name: "greet",
      tool_arguments: { name: "world" },
    });

    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    expect(result.isError).toBe(false);
    expect(mockClient.callTool.calls[0]).toEqual([{ name: "greet", arguments: { name: "world" } }]);
    expect(mockClient.close.calls.length).toBe(1);
  });

  test("returns isError when tool reports error", async () => {
    const mockClient = createMockClient({
      callTool: fn().mockResolvedValue({
        content: [{ type: "text", text: "something went wrong" }],
        isError: true,
      }),
    });
    mockFactory(mockClient);

    const task = new McpToolCallTask();
    const result = await task.run({ ...baseInput, tool_name: "fail" });

    expect(result.isError).toBe(true);
  });

  test("closes client even on error", async () => {
    const mockClient = createMockClient({
      callTool: fn().mockRejectedValue(new Error("connection lost")),
    });
    mockFactory(mockClient);

    const task = new McpToolCallTask();
    await expect(task.run({ ...baseInput, tool_name: "broken" })).rejects.toThrow(
      "connection lost"
    );
    expect(mockClient.close.calls.length).toBe(1);
  });

  test("has correct static properties", () => {
    expect(McpToolCallTask.type).toBe("McpToolCallTask");
    expect(McpToolCallTask.category).toBe("MCP");
    expect(McpToolCallTask.cacheable).toBe(false);
  });
});

describe("McpResourceReadTask", () => {
  test("reads a resource and returns contents", async () => {
    const mockClient = createMockClient({
      readResource: fn().mockResolvedValue({
        contents: [{ uri: "file:///test.txt", text: "file contents" }],
      }),
    });
    mockFactory(mockClient);

    const task = new McpResourceReadTask();
    const result = await task.run({ ...baseInput, resource_uri: "file:///test.txt" });

    expect(result.contents).toEqual([{ uri: "file:///test.txt", text: "file contents" }]);
    expect(mockClient.readResource.calls[0]).toEqual([{ uri: "file:///test.txt" }]);
    expect(mockClient.close.calls.length).toBe(1);
  });

  test("has correct static properties", () => {
    expect(McpResourceReadTask.type).toBe("McpResourceReadTask");
    expect(McpResourceReadTask.category).toBe("MCP");
    expect(McpResourceReadTask.cacheable).toBe(false);
  });
});

describe("McpPromptGetTask", () => {
  test("gets a prompt and returns messages", async () => {
    const mockClient = createMockClient({
      getPrompt: fn().mockResolvedValue({
        messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
        description: "A greeting prompt",
      }),
    });
    mockFactory(mockClient);

    const task = new McpPromptGetTask();
    const result = await task.run({
      ...baseInput,
      prompt_name: "greeting",
      prompt_arguments: { lang: "en" },
    });

    expect(result.messages).toEqual([{ role: "user", content: { type: "text", text: "Hello" } }]);
    expect(result.description).toBe("A greeting prompt");
    expect(mockClient.getPrompt.calls[0]).toEqual([
      { name: "greeting", arguments: { lang: "en" } },
    ]);
    expect(mockClient.close.calls.length).toBe(1);
  });

  test("has correct static properties", () => {
    expect(McpPromptGetTask.type).toBe("McpPromptGetTask");
    expect(McpPromptGetTask.category).toBe("MCP");
    expect(McpPromptGetTask.cacheable).toBe(false);
  });
});

describe("McpListTask", () => {
  test("lists tools", async () => {
    const tools = [{ name: "greet", description: "Greets", inputSchema: {} }];
    const mockClient = createMockClient({
      listTools: fn().mockResolvedValue({ tools }),
    });
    mockFactory(mockClient);

    const task = new McpListTask();
    const result = await task.run({ ...baseInput, list_type: "tools" });

    expect((result as { tools: unknown }).tools).toEqual(tools);
    expect(mockClient.listTools.calls.length).toBe(1);
    expect(mockClient.close.calls.length).toBe(1);
  });

  test("lists resources", async () => {
    const resources = [{ uri: "file:///a.txt", name: "a.txt" }];
    const mockClient = createMockClient({
      listResources: fn().mockResolvedValue({ resources }),
    });
    mockFactory(mockClient);

    const task = new McpListTask();
    const result = await task.run({ ...baseInput, list_type: "resources" });

    expect((result as { resources: unknown }).resources).toEqual(resources);
  });

  test("lists prompts", async () => {
    const prompts = [{ name: "greeting", description: "Greets" }];
    const mockClient = createMockClient({
      listPrompts: fn().mockResolvedValue({ prompts }),
    });
    mockFactory(mockClient);

    const task = new McpListTask();
    const result = await task.run({ ...baseInput, list_type: "prompts" });

    expect((result as { prompts: unknown }).prompts).toEqual(prompts);
  });

  test("has correct static properties", () => {
    expect(McpListTask.type).toBe("McpListTask");
    expect(McpListTask.category).toBe("MCP");
    expect(McpListTask.cacheable).toBe(false);
    expect(McpListTask.hasDynamicSchemas).toBe(true);
  });

  test("dynamic output schema changes based on list_type", () => {
    const task = new McpListTask();

    task.setInput({ list_type: "tools" });
    const toolsSchema = task.outputSchema();
    expect(toolsSchema).toHaveProperty("properties.tools");
    expect(toolsSchema).not.toHaveProperty("properties.resources");
    expect(toolsSchema).not.toHaveProperty("properties.prompts");

    task.setInput({ list_type: "resources" });
    const resourcesSchema = task.outputSchema();
    expect(resourcesSchema).toHaveProperty("properties.resources");
    expect(resourcesSchema).not.toHaveProperty("properties.tools");

    task.setInput({ list_type: "prompts" });
    const promptsSchema = task.outputSchema();
    expect(promptsSchema).toHaveProperty("properties.prompts");
    expect(promptsSchema).not.toHaveProperty("properties.tools");
  });

  test("returns all output types in static schema when no list_type set", () => {
    const schema = McpListTask.outputSchema();
    expect(schema).toHaveProperty("properties.tools");
    expect(schema).toHaveProperty("properties.resources");
    expect(schema).toHaveProperty("properties.prompts");
  });
});
