/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test, beforeEach, afterEach } from "vitest";
import {
  InMemoryMcpServerRepository,
  McpServerRepository,
  registerMcpServer,
  getMcpServer,
  getGlobalMcpServers,
  getGlobalMcpServerRepository,
  getMcpServerConfig,
  MCP_SERVERS,
  McpToolCallTask,
  McpListTask,
  mcpClientFactory,
} from "@workglow/tasks";
import type { McpServerRecord } from "@workglow/tasks";
import { resolveSchemaInputs, Task, type IExecuteContext, type TaskConfig } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { globalServiceRegistry, ServiceRegistry, Container } from "@workglow/util";

const serverA: McpServerRecord = {
  server_id: "server-a",
  label: "Server A",
  description: "Test server A",
  transport: "streamable-http",
  server_url: "http://localhost:3000/mcp",
};

const serverB: McpServerRecord = {
  server_id: "server-b",
  label: "Server B",
  description: "Test server B",
  transport: "stdio",
  command: "node",
  args: ["server.js"],
};

describe("McpServerRepository", () => {
  let repo: McpServerRepository;

  beforeEach(() => {
    repo = new InMemoryMcpServerRepository();
  });

  test("addServer stores and returns the record", async () => {
    const result = await repo.addServer(serverA);
    expect(result).toEqual(serverA);
  });

  test("getServer retrieves a stored record", async () => {
    await repo.addServer(serverA);
    const result = await repo.getServer("server-a");
    expect(result).toEqual(serverA);
  });

  test("getServer returns undefined for unknown ID", async () => {
    const result = await repo.getServer("nonexistent");
    expect(result).toBeUndefined();
  });

  test("removeServer deletes a stored record", async () => {
    await repo.addServer(serverA);
    await repo.removeServer("server-a");
    const result = await repo.getServer("server-a");
    expect(result).toBeUndefined();
  });

  test("removeServer throws for unknown ID", async () => {
    await expect(repo.removeServer("nonexistent")).rejects.toThrow(
      'MCP server with id "nonexistent" not found'
    );
  });

  test("enumerateAll returns all stored records", async () => {
    await repo.addServer(serverA);
    await repo.addServer(serverB);
    const all = await repo.enumerateAll();
    expect(all).toHaveLength(2);
    expect(all).toEqual(expect.arrayContaining([serverA, serverB]));
  });

  test("enumerateAll returns empty array when empty", async () => {
    const all = await repo.enumerateAll();
    expect(all).toEqual([]);
  });

  test("size returns count of stored records", async () => {
    expect(await repo.size()).toBe(0);
    await repo.addServer(serverA);
    expect(await repo.size()).toBe(1);
    await repo.addServer(serverB);
    expect(await repo.size()).toBe(2);
  });

  test("addServer overwrites duplicate ID", async () => {
    await repo.addServer(serverA);
    const updated: McpServerRecord = { ...serverA, label: "Updated A" };
    await repo.addServer(updated);
    const result = await repo.getServer("server-a");
    expect(result?.label).toBe("Updated A");
    expect(await repo.size()).toBe(1);
  });

  test("emits server_added event", async () => {
    const events: McpServerRecord[] = [];
    repo.on("server_added", (record) => events.push(record));
    await repo.addServer(serverA);
    expect(events).toEqual([serverA]);
  });

  test("emits server_removed event", async () => {
    const events: McpServerRecord[] = [];
    repo.on("server_removed", (record) => events.push(record));
    await repo.addServer(serverA);
    await repo.removeServer("server-a");
    expect(events).toEqual([serverA]);
  });
});

describe("McpServerRegistry", () => {
  beforeEach(() => {
    getGlobalMcpServers().clear();
  });

  test("registerMcpServer adds to live map and repository", async () => {
    await registerMcpServer("test-server", serverA);
    expect(getMcpServer("test-server")?.config).toEqual(serverA);

    const repo = getGlobalMcpServerRepository();
    const record = await repo.getServer("server-a");
    expect(record).toEqual(serverA);
  });

  test("getMcpServer returns undefined for unknown ID", () => {
    expect(getMcpServer("nonexistent")).toBeUndefined();
  });

  test("scoped registries are independent", async () => {
    await registerMcpServer("shared", serverA);

    const child = new ServiceRegistry(new Container());
    const scopedMap = new Map();
    child.registerInstance(MCP_SERVERS, scopedMap);

    const scopedServers = child.get(MCP_SERVERS);
    expect(scopedServers.get("shared")).toBeUndefined();

    expect(getMcpServer("shared")?.config).toEqual(serverA);
  });
});

describe("mcp-server input resolver", () => {
  beforeEach(() => {
    getGlobalMcpServers().clear();
  });

  test("resolves string server ID to config record", async () => {
    await registerMcpServer("my-server", serverA);

    const schema = {
      type: "object" as const,
      properties: {
        server: { type: "string" as const, format: "mcp-server" },
      },
    };
    const input = { server: "my-server" };
    const resolved = await resolveSchemaInputs(input, schema, {
      registry: globalServiceRegistry,
    });

    expect(resolved.server).toEqual(serverA);
  });

  test("throws for unknown server ID", async () => {
    const schema = {
      type: "object" as const,
      properties: {
        server: { type: "string" as const, format: "mcp-server" },
      },
    };
    const input = { server: "nonexistent" };
    await expect(
      resolveSchemaInputs(input, schema, { registry: globalServiceRegistry })
    ).rejects.toThrow('MCP server "nonexistent" not found');
  });

  test("non-string values pass through unchanged", async () => {
    const schema = {
      type: "object" as const,
      properties: {
        server: {
          oneOf: [
            { type: "string" as const, format: "mcp-server" },
            { type: "object" as const, format: "mcp-server" },
          ],
        },
      },
    };
    const inlineConfig = { transport: "sse", server_url: "http://example.com" };
    const input = { server: inlineConfig };
    const resolved = await resolveSchemaInputs(input, schema, {
      registry: globalServiceRegistry,
    });

    expect(resolved.server).toEqual(inlineConfig);
  });

  test("scoped registry takes precedence over global", async () => {
    await registerMcpServer("my-server", serverA);

    const child = new ServiceRegistry(new Container());
    const scopedMap = new Map();
    scopedMap.set("my-server", { config: serverB });
    child.registerInstance(MCP_SERVERS, scopedMap);

    const schema = {
      type: "object" as const,
      properties: {
        server: { type: "string" as const, format: "mcp-server" },
      },
    };
    const input = { server: "my-server" };
    const resolved = await resolveSchemaInputs(input, schema, {
      registry: child,
    });

    expect(resolved.server).toEqual(serverB);
  });
});

describe("getMcpServerConfig", () => {
  test("returns server config from resolved server object", () => {
    const resolvedConfig = {
      server: {
        server_id: "a",
        transport: "streamable-http",
        server_url: "http://localhost:3000/mcp",
      },
    };
    const result = getMcpServerConfig({}, resolvedConfig);
    expect(result.transport).toBe("streamable-http");
    expect(result.server_url).toBe("http://localhost:3000/mcp");
  });

  test("inline config values override resolved server", () => {
    const resolvedConfig = {
      server: {
        server_id: "a",
        transport: "sse",
        server_url: "http://registry-url.com",
      },
    };
    const config = { transport: "streamable-http", server_url: "http://override.com" };
    const result = getMcpServerConfig(config, resolvedConfig);
    expect(result.transport).toBe("streamable-http");
    expect(result.server_url).toBe("http://override.com");
  });

  test("works with inline-only config (no server reference)", () => {
    const config = {
      transport: "stdio",
      command: "node",
      args: ["server.js"],
    };
    const result = getMcpServerConfig(config, undefined);
    expect(result.transport).toBe("stdio");
    expect(result.command).toBe("node");
  });

  test("works when server is an inline object in config", () => {
    const config = {
      server: {
        transport: "sse",
        server_url: "http://inline.com",
      },
    };
    const result = getMcpServerConfig(config, undefined);
    expect(result.transport).toBe("sse");
    expect(result.server_url).toBe("http://inline.com");
  });

  test("throws when no transport is available from any source", () => {
    expect(() => getMcpServerConfig({}, undefined)).toThrow(
      "MCP server config must include a transport"
    );
  });

  test("merges auth fields from resolved server", () => {
    const resolvedConfig = {
      server: {
        server_id: "a",
        transport: "streamable-http",
        server_url: "http://localhost:3000",
        auth_type: "bearer",
        auth_token: "secret-token",
      },
    };
    const result = getMcpServerConfig({}, resolvedConfig);
    expect((result as Record<string, unknown>).auth_type).toBe("bearer");
  });
});

class ConfigResolverTestTask extends Task<
  { value: string },
  { result: string; receivedResolvedConfig: unknown },
  TaskConfig & { server?: unknown }
> {
  static readonly type = "ConfigResolverTestTask";
  static readonly category = "Test";

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: { type: "string" },
        receivedResolvedConfig: { type: "object", additionalProperties: true },
      },
      required: ["result"],
    } as const satisfies DataPortSchema;
  }

  static configSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        server: { type: "string", format: "mcp-server" },
      },
    } as const satisfies DataPortSchema;
  }

  async execute(
    input: { value: string },
    context: IExecuteContext
  ): Promise<{ result: string; receivedResolvedConfig: unknown }> {
    return {
      result: input.value,
      receivedResolvedConfig: context.resolvedConfig,
    };
  }
}

describe("TaskRunner config resolution", () => {
  beforeEach(() => {
    getGlobalMcpServers().clear();
  });

  test("resolvedConfig is populated in IExecuteContext", async () => {
    await registerMcpServer("test-srv", serverA);
    const task = new ConfigResolverTestTask({}, { server: "test-srv" });
    const output = await task.run({ value: "hello" });

    expect(output.receivedResolvedConfig).toBeDefined();
    const rc = output.receivedResolvedConfig as Record<string, unknown>;
    expect(rc.server).toEqual(serverA);
  });

  test("original task.config is not mutated", async () => {
    await registerMcpServer("test-srv", serverA);
    const task = new ConfigResolverTestTask({}, { server: "test-srv" });
    await task.run({ value: "hello" });

    // Config should still have the string ID, not the resolved object
    expect(task.config.server).toBe("test-srv");
  });

  test("resolvedConfig is empty when config has no format annotations", async () => {
    const task = new ConfigResolverTestTask({}, {});
    const output = await task.run({ value: "hello" });

    const rc = output.receivedResolvedConfig as Record<string, unknown>;
    expect(rc).toBeDefined();
    expect(rc.server).toBeUndefined();
  });
});

// Mock helpers (same pattern as existing mcp.test.ts)
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
  return mock;
}

function createMockClient(overrides: Record<string, unknown> = {}) {
  return {
    callTool: fn(),
    readResource: fn(),
    getPrompt: fn(),
    listTools: fn().mockResolvedValue({ tools: [] }),
    listResources: fn().mockResolvedValue({ resources: [] }),
    listPrompts: fn().mockResolvedValue({ prompts: [] }),
    close: fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const originalCreate = mcpClientFactory.create;

function mockFactory(mockClient: ReturnType<typeof createMockClient>) {
  mcpClientFactory.create = (() =>
    Promise.resolve({
      client: mockClient,
      transport: {},
    })) as unknown as typeof mcpClientFactory.create;
}

describe("MCP tasks with server registry", () => {
  beforeEach(() => {
    getGlobalMcpServers().clear();
    mcpClientFactory.create = originalCreate;
  });

  afterEach(() => {
    mcpClientFactory.create = originalCreate;
  });

  test("McpToolCallTask with server ID in config", async () => {
    await registerMcpServer("my-server", serverA);
    const mockClient = createMockClient({
      callTool: fn().mockResolvedValue({
        content: [{ type: "text", text: "hello" }],
        isError: false,
      }),
    });
    mockFactory(mockClient);

    const task = new McpToolCallTask(
      {},
      { server: "my-server", tool_name: "greet" }
    );
    const result = await task.run({ name: "world" });

    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    expect(result.isError).toBe(false);
  });

  test("McpToolCallTask with inline server object in config", async () => {
    const mockClient = createMockClient({
      callTool: fn().mockResolvedValue({
        content: [{ type: "text", text: "hi" }],
        isError: false,
      }),
    });
    mockFactory(mockClient);

    const task = new McpToolCallTask(
      {},
      {
        server: { transport: "streamable-http", server_url: "http://inline.com" },
        tool_name: "greet",
      }
    );
    const result = await task.run({});

    expect(result.content).toEqual([{ type: "text", text: "hi" }]);
  });

  test("McpToolCallTask backward compatible with inline transport", async () => {
    const mockClient = createMockClient({
      callTool: fn().mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        isError: false,
      }),
    });
    mockFactory(mockClient);

    const task = new McpToolCallTask(
      {},
      { transport: "stdio", command: "test-server", tool_name: "greet" }
    );
    const result = await task.run({});

    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
  });

  test("inline config overrides registry values", async () => {
    await registerMcpServer("my-server", serverA);
    const mockClient = createMockClient({
      callTool: fn().mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        isError: false,
      }),
    });
    let capturedConfig: unknown;
    mcpClientFactory.create = ((config: unknown) => {
      capturedConfig = config;
      return Promise.resolve({ client: mockClient, transport: {} });
    }) as unknown as typeof mcpClientFactory.create;

    const task = new McpToolCallTask(
      {},
      {
        server: "my-server",
        server_url: "http://override.com",
        tool_name: "greet",
      }
    );
    await task.run({});

    expect((capturedConfig as Record<string, unknown>).server_url).toBe(
      "http://override.com"
    );
    expect((capturedConfig as Record<string, unknown>).transport).toBe(
      "streamable-http"
    );
  });

  test("McpListTask with server ID in input", async () => {
    await registerMcpServer("my-server", serverA);
    const tools = [{ name: "greet", inputSchema: {} }];
    const mockClient = createMockClient({
      listTools: fn().mockResolvedValue({ tools }),
    });
    mockFactory(mockClient);

    const task = new McpListTask();
    const result = await task.run({
      server: "my-server",
      list_type: "tools",
    });

    expect((result as { tools: unknown }).tools).toEqual(tools);
  });
});
