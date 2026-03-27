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
  MCP_SERVERS,
} from "@workglow/tasks";
import type { McpServerRecord } from "@workglow/tasks";
import { resolveSchemaInputs } from "@workglow/task-graph";
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
