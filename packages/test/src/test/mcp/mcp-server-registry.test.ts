/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test, beforeEach } from "vitest";
import {
  InMemoryMcpServerRepository,
  McpServerRepository,
} from "@workglow/tasks";
import type { McpServerRecord } from "@workglow/tasks";

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
