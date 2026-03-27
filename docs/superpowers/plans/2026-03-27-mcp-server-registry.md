# MCP Server Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow MCP tasks to reference pre-configured servers by ID instead of requiring inline connection details, using a dual-layer registry (persistent config repository + scoped live connection map).

**Architecture:** Follows the KnowledgeBase dual pattern. `McpServerRepository` stores config records in tabular storage (shared). `McpServerRegistry` holds a scoped `Map<string, McpServerConnection>` for future connection reuse. Input resolver wires up `format: "mcp-server"` so string IDs are resolved automatically. TaskRunner gains config schema resolution (non-mutating) passed via `IExecuteContext.resolvedConfig`.

**Tech Stack:** TypeScript, `@workglow/storage` (InMemoryTabularStorage), `@workglow/util` (ServiceRegistry, EventEmitter, registerInputResolver), vitest

**Spec:** `docs/superpowers/specs/2026-03-27-mcp-server-registry-design.md`

---

### Task 1: McpServerSchema

**Files:**
- Create: `packages/tasks/src/mcp-server/McpServerSchema.ts`

- [ ] **Step 1: Create the schema file**

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject, FromSchema } from "@workglow/util/schema";
import { mcpAuthConfigSchema } from "../util/McpAuthTypes";

export const McpServerRecordSchema = {
  type: "object",
  properties: {
    server_id: { type: "string" },
    label: { type: "string" },
    description: { type: "string" },
    transport: { type: "string", enum: ["stdio", "sse", "streamable-http"] },
    server_url: { type: "string" },
    command: { type: "string" },
    args: { type: "array", items: { type: "string" } },
    env: { type: "object", additionalProperties: { type: "string" } },
    ...mcpAuthConfigSchema.properties,
  },
  required: ["server_id", "transport"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type McpServerRecord = FromSchema<typeof McpServerRecordSchema>;
export const McpServerPrimaryKeyNames = ["server_id"] as const;
```

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/tasks && npx tsc --noEmit src/mcp-server/McpServerSchema.ts 2>&1 || bun build --no-bundle src/mcp-server/McpServerSchema.ts --outdir /tmp/check`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/tasks/src/mcp-server/McpServerSchema.ts
git commit -m "feat(tasks): add McpServerRecordSchema and types"
```

---

### Task 2: McpServerRepository + InMemoryMcpServerRepository

**Files:**
- Create: `packages/tasks/src/mcp-server/McpServerRepository.ts`
- Create: `packages/tasks/src/mcp-server/InMemoryMcpServerRepository.ts`
- Test: `packages/test/src/test/mcp/mcp-server-registry.test.ts`

- [ ] **Step 1: Write repository tests**

Create `packages/test/src/test/mcp/mcp-server-registry.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/test && bun test mcp-server-registry`

Expected: FAIL -- modules not found

- [ ] **Step 3: Implement McpServerRepository**

Create `packages/tasks/src/mcp-server/McpServerRepository.ts`:

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ITabularStorage } from "@workglow/storage";
import { EventEmitter, type EventParameters } from "@workglow/util";

import {
  McpServerPrimaryKeyNames,
  type McpServerRecord,
  McpServerRecordSchema,
} from "./McpServerSchema";

export type McpServerEventListeners = {
  server_added: (record: McpServerRecord) => void;
  server_removed: (record: McpServerRecord) => void;
  server_updated: (record: McpServerRecord) => void;
};

export type McpServerEvents = keyof McpServerEventListeners;

export type McpServerEventListener<Event extends McpServerEvents> =
  McpServerEventListeners[Event];

export type McpServerEventParameters<Event extends McpServerEvents> = EventParameters<
  McpServerEventListeners,
  Event
>;

export class McpServerRepository {
  protected readonly storage: ITabularStorage<
    typeof McpServerRecordSchema,
    typeof McpServerPrimaryKeyNames
  >;

  constructor(
    storage: ITabularStorage<
      typeof McpServerRecordSchema,
      typeof McpServerPrimaryKeyNames
    >
  ) {
    this.storage = storage;
  }

  protected events = new EventEmitter<McpServerEventListeners>();

  async setupDatabase(): Promise<void> {
    await this.storage.setupDatabase?.();
  }

  on<Event extends McpServerEvents>(name: Event, fn: McpServerEventListener<Event>) {
    this.events.on(name, fn);
  }

  off<Event extends McpServerEvents>(name: Event, fn: McpServerEventListener<Event>) {
    this.events.off(name, fn);
  }

  once<Event extends McpServerEvents>(name: Event, fn: McpServerEventListener<Event>) {
    this.events.once(name, fn);
  }

  waitOn<Event extends McpServerEvents>(name: Event) {
    return this.events.waitOn(name);
  }

  async addServer(record: McpServerRecord): Promise<McpServerRecord> {
    await this.storage.put(record);
    this.events.emit("server_added", record);
    return record;
  }

  async removeServer(server_id: string): Promise<void> {
    const record = await this.storage.get({ server_id });
    if (!record) {
      throw new Error(`MCP server with id "${server_id}" not found`);
    }
    await this.storage.delete({ server_id });
    this.events.emit("server_removed", record);
  }

  async getServer(server_id: string): Promise<McpServerRecord | undefined> {
    if (typeof server_id !== "string") return undefined;
    const record = await this.storage.get({ server_id });
    return record ?? undefined;
  }

  async enumerateAll(): Promise<McpServerRecord[]> {
    const records = await this.storage.getAll();
    if (!records || records.length === 0) return [];
    return records;
  }

  async size(): Promise<number> {
    return await this.storage.size();
  }
}
```

- [ ] **Step 4: Implement InMemoryMcpServerRepository**

Create `packages/tasks/src/mcp-server/InMemoryMcpServerRepository.ts`:

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import { McpServerRepository } from "./McpServerRepository";
import { McpServerPrimaryKeyNames, McpServerRecordSchema } from "./McpServerSchema";

export class InMemoryMcpServerRepository extends McpServerRepository {
  constructor() {
    super(new InMemoryTabularStorage(McpServerRecordSchema, McpServerPrimaryKeyNames));
  }
}
```

- [ ] **Step 5: Export from common.ts**

Add to `packages/tasks/src/common.ts` near the top exports:

```ts
export * from "./mcp-server/McpServerSchema";
export * from "./mcp-server/McpServerRepository";
export * from "./mcp-server/InMemoryMcpServerRepository";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/test && bun test mcp-server-registry`

Expected: All 10 tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/tasks/src/mcp-server/McpServerSchema.ts \
       packages/tasks/src/mcp-server/McpServerRepository.ts \
       packages/tasks/src/mcp-server/InMemoryMcpServerRepository.ts \
       packages/tasks/src/common.ts \
       packages/test/src/test/mcp/mcp-server-registry.test.ts
git commit -m "feat(tasks): add McpServerRepository with InMemory impl and tests"
```

---

### Task 3: McpServerRegistry (dual-layer + input resolver)

**Files:**
- Create: `packages/tasks/src/mcp-server/McpServerRegistry.ts`
- Modify: `packages/tasks/src/common.ts`
- Test: `packages/test/src/test/mcp/mcp-server-registry.test.ts` (append)

- [ ] **Step 1: Write registry and resolver tests**

Append to `packages/test/src/test/mcp/mcp-server-registry.test.ts`:

```ts
import {
  registerMcpServer,
  getMcpServer,
  getGlobalMcpServers,
  getGlobalMcpServerRepository,
  MCP_SERVERS,
  MCP_SERVER_REPOSITORY,
} from "@workglow/tasks";
import { resolveSchemaInputs } from "@workglow/task-graph";
import {
  globalServiceRegistry,
  ServiceRegistry,
  Container,
} from "@workglow/util";

describe("McpServerRegistry", () => {
  beforeEach(() => {
    // Clear the global live map between tests
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

    // Scoped registry doesn't see global entries
    const scopedServers = child.get(MCP_SERVERS);
    expect(scopedServers.get("shared")).toBeUndefined();

    // Global still has it
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/test && bun test mcp-server-registry`

Expected: FAIL -- imports not found

- [ ] **Step 3: Implement McpServerRegistry**

Create `packages/tasks/src/mcp-server/McpServerRegistry.ts`:

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createServiceToken,
  globalServiceRegistry,
  registerInputResolver,
  ServiceRegistry,
} from "@workglow/util";
import { InMemoryMcpServerRepository } from "./InMemoryMcpServerRepository";
import { McpServerRepository } from "./McpServerRepository";
import type { McpServerRecord } from "./McpServerSchema";

export interface McpServerConnection {
  readonly config: McpServerRecord;
}

export const MCP_SERVERS = createServiceToken<Map<string, McpServerConnection>>(
  "mcp-server.registry"
);

export const MCP_SERVER_REPOSITORY = createServiceToken<McpServerRepository>(
  "mcp-server.repository"
);

if (!globalServiceRegistry.has(MCP_SERVERS)) {
  globalServiceRegistry.register(
    MCP_SERVERS,
    (): Map<string, McpServerConnection> => new Map(),
    true
  );
}

if (!globalServiceRegistry.has(MCP_SERVER_REPOSITORY)) {
  globalServiceRegistry.register(
    MCP_SERVER_REPOSITORY,
    (): McpServerRepository => new InMemoryMcpServerRepository(),
    true
  );
}

export function getGlobalMcpServers(): Map<string, McpServerConnection> {
  return globalServiceRegistry.get(MCP_SERVERS);
}

export function getGlobalMcpServerRepository(): McpServerRepository {
  return globalServiceRegistry.get(MCP_SERVER_REPOSITORY);
}

export function setGlobalMcpServerRepository(repository: McpServerRepository): void {
  globalServiceRegistry.registerInstance(MCP_SERVER_REPOSITORY, repository);
}

export async function registerMcpServer(
  id: string,
  config: McpServerRecord
): Promise<void> {
  const servers = getGlobalMcpServers();
  servers.set(id, { config });

  const repo = getGlobalMcpServerRepository();
  await repo.addServer(config);
}

export function getMcpServer(id: string): McpServerConnection | undefined {
  return getGlobalMcpServers().get(id);
}

async function resolveServerFromRegistry(
  id: string,
  _format: string,
  registry: ServiceRegistry
): Promise<McpServerRecord> {
  // Check scoped registry first
  const servers = registry.has(MCP_SERVERS)
    ? registry.get<Map<string, McpServerConnection>>(MCP_SERVERS)
    : getGlobalMcpServers();

  const entry = servers.get(id);
  if (entry) return entry.config;

  // Fall back to repository lookup
  const repo = registry.has(MCP_SERVER_REPOSITORY)
    ? registry.get<McpServerRepository>(MCP_SERVER_REPOSITORY)
    : getGlobalMcpServerRepository();

  const record = await repo.getServer(id);
  if (!record) {
    throw new Error(`MCP server "${id}" not found in registry`);
  }
  return record;
}

registerInputResolver("mcp-server", resolveServerFromRegistry);
```

- [ ] **Step 4: Export from common.ts**

Add to `packages/tasks/src/common.ts`:

```ts
export * from "./mcp-server/McpServerRegistry";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/test && bun test mcp-server-registry`

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/tasks/src/mcp-server/McpServerRegistry.ts \
       packages/tasks/src/common.ts \
       packages/test/src/test/mcp/mcp-server-registry.test.ts
git commit -m "feat(tasks): add McpServerRegistry with dual-layer pattern and input resolver"
```

---

### Task 4: getMcpServerConfig helper

**Files:**
- Create: `packages/tasks/src/mcp-server/getMcpServerConfig.ts`
- Modify: `packages/tasks/src/common.ts`
- Test: `packages/test/src/test/mcp/mcp-server-registry.test.ts` (append)

- [ ] **Step 1: Write getMcpServerConfig tests**

Append to `packages/test/src/test/mcp/mcp-server-registry.test.ts`:

```ts
import { getMcpServerConfig } from "@workglow/tasks";

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
    expect(result.auth_type).toBe("bearer");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/test && bun test mcp-server-registry`

Expected: FAIL -- getMcpServerConfig not found

- [ ] **Step 3: Implement getMcpServerConfig**

Create `packages/tasks/src/mcp-server/getMcpServerConfig.ts`:

```ts
/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpServerConfig } from "../util/McpTaskDeps";

const SERVER_CONFIG_KEYS: readonly string[] = [
  "transport",
  "server_url",
  "command",
  "args",
  "env",
  "auth",
  "auth_type",
  "auth_token",
  "auth_client_id",
  "auth_client_secret",
  "auth_private_key",
  "auth_algorithm",
  "auth_jwt_bearer_assertion",
  "auth_redirect_url",
  "auth_scope",
  "auth_client_name",
  "auth_jwt_lifetime_seconds",
] as const;

/**
 * Merges resolved server config with inline overrides to produce a McpServerConfig.
 *
 * Resolution order:
 * 1. If `resolvedConfig.server` is an object (resolved from registry), use it as base
 * 2. If `configOrInput.server` is an object (inline), use it as base (when no resolver ran)
 * 3. Overlay any explicit inline properties from configOrInput
 * 4. Validate that transport is available
 *
 * @param configOrInput - The task's config or input object (may contain inline server fields)
 * @param resolvedConfig - The resolved config from TaskRunner (may contain resolved `server` object)
 */
export function getMcpServerConfig(
  configOrInput: Readonly<Record<string, unknown>>,
  resolvedConfig: Readonly<Record<string, unknown>> | undefined
): McpServerConfig {
  // Start with resolved server config (from registry resolver)
  let base: Record<string, unknown> = {};

  const resolvedServer = resolvedConfig?.server;
  if (resolvedServer && typeof resolvedServer === "object" && !Array.isArray(resolvedServer)) {
    base = { ...(resolvedServer as Record<string, unknown>) };
  }

  // If no resolved server, check for inline server object in configOrInput
  const inlineServer = configOrInput.server;
  if (
    Object.keys(base).length === 0 &&
    inlineServer &&
    typeof inlineServer === "object" &&
    !Array.isArray(inlineServer)
  ) {
    base = { ...(inlineServer as Record<string, unknown>) };
  }

  // Overlay inline config values (only defined, non-server keys)
  for (const key of SERVER_CONFIG_KEYS) {
    const value = configOrInput[key];
    if (value !== undefined) {
      base[key] = value;
    }
  }

  if (!base.transport) {
    throw new Error(
      "MCP server config must include a transport (from server reference or inline config)"
    );
  }

  return base as unknown as McpServerConfig;
}
```

- [ ] **Step 4: Export from common.ts**

Add to `packages/tasks/src/common.ts`:

```ts
export * from "./mcp-server/getMcpServerConfig";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/test && bun test mcp-server-registry`

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/tasks/src/mcp-server/getMcpServerConfig.ts \
       packages/tasks/src/common.ts \
       packages/test/src/test/mcp/mcp-server-registry.test.ts
git commit -m "feat(tasks): add getMcpServerConfig helper for merging registry + inline config"
```

---

### Task 5: TaskRunner config resolution + IExecuteContext.resolvedConfig

**Files:**
- Modify: `packages/task-graph/src/task/ITask.ts`
- Modify: `packages/task-graph/src/task/TaskRunner.ts`
- Test: `packages/test/src/test/mcp/mcp-server-registry.test.ts` (append)

- [ ] **Step 1: Write TaskRunner config resolution tests**

Append to `packages/test/src/test/mcp/mcp-server-registry.test.ts`:

```ts
import { Task, type IExecuteContext, type TaskConfig } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";

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
    // No server key resolved since none was provided
    expect(rc.server).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/test && bun test mcp-server-registry`

Expected: FAIL -- `resolvedConfig` is undefined in context

- [ ] **Step 3: Add resolvedConfig to IExecuteContext**

In `packages/task-graph/src/task/ITask.ts`, add `resolvedConfig` to `IExecuteContext`:

```ts
export interface IExecuteContext {
  signal: AbortSignal;
  updateProgress: (progress: number, message?: string, ...args: any[]) => Promise<void>;
  own: <T extends ITask | ITaskGraph | IWorkflow>(i: T) => T;
  registry: ServiceRegistry;
  /**
   * Config schema properties resolved by TaskRunner (e.g. format: "mcp-server").
   * Read-only -- task.config is never mutated.
   */
  resolvedConfig?: Readonly<Record<string, unknown>>;
  /**
   * Input streams for pass-through streaming tasks. Keyed by input port name.
   * Provided when the graph runner detects that a task has streaming input edges
   * and the task implements executeStream(). The task's executeStream() can read
   * from these streams and re-yield events for immediate downstream delivery.
   */
  inputStreams?: Map<string, ReadableStream<StreamEvent>>;
}
```

- [ ] **Step 4: Add config resolution to TaskRunner.run()**

In `packages/task-graph/src/task/TaskRunner.ts`, in the `run()` method, after `this.task.setInput(overrides)` (line 137) and before the input schema resolution (line 140), add config resolution:

```ts
      this.task.setInput(overrides);

      // Resolve config schema annotations (e.g. mcp-server references) without mutating config
      const configSchema = (this.task.constructor as typeof Task).configSchema();
      const resolvedConfig = await resolveSchemaInputs(
        { ...this.task.config } as Record<string, unknown>,
        configSchema,
        { registry: this.registry }
      );

      // Resolve schema-annotated inputs (models, repositories) before validation
```

Store `resolvedConfig` as a class field so it's available to `executeTask` and `executeStreamingTask`:

Add a protected field:

```ts
  protected resolvedConfig?: Readonly<Record<string, unknown>>;
```

Set it in `run()`:

```ts
      this.resolvedConfig = Object.freeze(resolvedConfig);
```

- [ ] **Step 5: Pass resolvedConfig through IExecuteContext**

Update `executeTask()` in TaskRunner to include `resolvedConfig`:

```ts
  protected async executeTask(input: Input): Promise<Output | undefined> {
    const result = await this.task.execute(input, {
      signal: this.abortController!.signal,
      updateProgress: this.handleProgress.bind(this),
      own: this.own,
      registry: this.registry,
      resolvedConfig: this.resolvedConfig,
    });
    return await this.executeTaskReactive(input, result || ({} as Output));
  }
```

Update the streaming path in `executeStreamingTask()`:

```ts
    const stream = this.task.executeStream!(input, {
      signal: this.abortController!.signal,
      updateProgress: this.handleProgress.bind(this),
      own: this.own,
      registry: this.registry,
      inputStreams: this.inputStreams,
      resolvedConfig: this.resolvedConfig,
    });
```

- [ ] **Step 6: Add config resolution to runReactive()**

In `runReactive()`, after `this.task.setInput(overrides)` and before input resolution, add the same config resolution:

```ts
    this.task.setInput(overrides);

    // Resolve config schema annotations without mutating config
    const configSchema = (this.task.constructor as typeof Task).configSchema();
    const resolvedConfig = await resolveSchemaInputs(
      { ...this.task.config } as Record<string, unknown>,
      configSchema,
      { registry: this.registry }
    );
    this.resolvedConfig = Object.freeze(resolvedConfig);

    // Resolve schema-annotated inputs (models, repositories) before validation
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/test && bun test mcp-server-registry`

Expected: All tests PASS

- [ ] **Step 8: Run existing tests to verify no regressions**

Run: `cd packages/test && bun test mcp`

Expected: All existing MCP tests still pass (68 + new tests)

- [ ] **Step 9: Commit**

```bash
git add packages/task-graph/src/task/ITask.ts \
       packages/task-graph/src/task/TaskRunner.ts \
       packages/test/src/test/mcp/mcp-server-registry.test.ts
git commit -m "feat(task-graph): add config schema resolution to TaskRunner with resolvedConfig in IExecuteContext"
```

---

### Task 6: Update MCP tasks to support server property

**Files:**
- Modify: `packages/tasks/src/task/mcp/McpToolCallTask.ts`
- Modify: `packages/tasks/src/task/mcp/McpPromptGetTask.ts`
- Modify: `packages/tasks/src/task/mcp/McpResourceReadTask.ts`
- Modify: `packages/tasks/src/task/mcp/McpListTask.ts`
- Test: `packages/test/src/test/mcp/mcp-server-registry.test.ts` (append)

- [ ] **Step 1: Write task integration tests**

Append to `packages/test/src/test/mcp/mcp-server-registry.test.ts`:

```ts
import {
  McpToolCallTask,
  McpListTask,
  mcpClientFactory,
} from "@workglow/tasks";

// Reuse mock helpers from the existing mcp.test.ts pattern
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
    // Capture the config passed to create
    let capturedConfig: unknown;
    mcpClientFactory.create = ((config: unknown) => {
      capturedConfig = config;
      return Promise.resolve({ client: mockClient, transport: {} });
    }) as typeof mcpClientFactory.create;

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
    // Transport comes from registry
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/test && bun test mcp-server-registry`

Expected: FAIL -- tasks don't support `server` property yet

- [ ] **Step 3: Update McpToolCallTask**

In `packages/tasks/src/task/mcp/McpToolCallTask.ts`:

1. Add import for `getMcpServerConfig`:

```ts
import { getMcpServerConfig } from "../../mcp-server/getMcpServerConfig";
```

2. Update `configSchema()` to add `server` property and relax `transport` requirement:

```ts
  public static configSchema(): DataPortSchema {
    const { mcpServerConfigSchema } = getMcpTaskDeps();
    return {
      type: "object",
      properties: {
        ...TaskConfigSchema["properties"],
        server: {
          oneOf: [
            { type: "string", format: "mcp-server" },
            {
              type: "object",
              format: "mcp-server",
              properties: mcpServerConfigSchema.properties,
              additionalProperties: false,
            },
          ],
          title: "Server",
          description: "MCP server reference (ID or inline config)",
        },
        ...mcpServerConfigSchema.properties,
        tool_name: {
          type: "string",
          title: "Tool Name",
          description: "The name of the tool to call",
          format: "string:mcp-toolname",
        },
      },
      required: ["tool_name"],
      allOf: mcpServerConfigSchema.allOf,
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
```

3. Update `execute()` to use `getMcpServerConfig`:

```ts
  async execute(
    input: McpToolCallTaskInput,
    context: IExecuteContext
  ): Promise<McpToolCallTaskOutput> {
    const serverConfig = getMcpServerConfig(
      this.config as Record<string, unknown>,
      context.resolvedConfig
    );

    await this.discoverSchemas(context.signal);

    const { mcpClientFactory } = getMcpTaskDeps();
    const { client } = await mcpClientFactory.create(serverConfig, context.signal);
```

4. Update `discoverSchemas` to also use the server config. Change the method to accept config:

```ts
  async discoverSchemas(signal?: AbortSignal, serverConfig?: McpServerConfig): Promise<void> {
    if (this.config.inputSchema && this.config.outputSchema) return;
    if (this._schemasDiscovering) return;
    const transport = serverConfig?.transport ?? this.config.transport;
    if (!transport || !this.config.tool_name) return;

    this._schemasDiscovering = true;
    try {
      const result = await mcpList({
        transport,
        server_url: serverConfig?.server_url ?? this.config.server_url,
        command: serverConfig?.command ?? this.config.command,
        args: serverConfig?.args ?? this.config.args,
        env: serverConfig?.env ?? this.config.env,
        list_type: "tools",
      } as McpListTaskInput);
```

Then update the `execute()` call to pass serverConfig:

```ts
    await this.discoverSchemas(context.signal, serverConfig);
```

- [ ] **Step 4: Update McpPromptGetTask**

In `packages/tasks/src/task/mcp/McpPromptGetTask.ts`:

1. Add import: `import { getMcpServerConfig } from "../../mcp-server/getMcpServerConfig";`

2. Update `configSchema()` -- same pattern as McpToolCallTask: add `server` property, change `required` to `["prompt_name"]` only.

3. Update `execute()`:

```ts
  async execute(
    input: McpPromptGetTaskInput,
    context: IExecuteContext
  ): Promise<McpPromptGetTaskOutput> {
    const serverConfig = getMcpServerConfig(
      this.config as Record<string, unknown>,
      context.resolvedConfig
    );

    await this.discoverSchemas(context.signal, serverConfig);

    const { mcpClientFactory } = getMcpTaskDeps();
    const { client } = await mcpClientFactory.create(serverConfig, context.signal);
```

4. Update `discoverSchemas` with same pattern as McpToolCallTask.

- [ ] **Step 5: Update McpResourceReadTask**

In `packages/tasks/src/task/mcp/McpResourceReadTask.ts`:

1. Add import: `import { getMcpServerConfig } from "../../mcp-server/getMcpServerConfig";`

2. Update `configSchema()` -- add `server` property, change `required` to `["resource_uri"]` only.

3. Update `execute()`:

```ts
  async execute(
    _input: McpResourceReadTaskInput,
    context: IExecuteContext
  ): Promise<McpResourceReadTaskOutput> {
    const serverConfig = getMcpServerConfig(
      this.config as Record<string, unknown>,
      context.resolvedConfig
    );

    const { mcpClientFactory } = getMcpTaskDeps();
    const { client } = await mcpClientFactory.create(serverConfig, context.signal);
```

- [ ] **Step 6: Update McpListTask**

In `packages/tasks/src/task/mcp/McpListTask.ts`:

1. Add import: `import { getMcpServerConfig } from "../../mcp-server/getMcpServerConfig";`

2. Update `inputSchema()` to add `server` and relax `transport` requirement:

```ts
  public static inputSchema(): DataPortSchema {
    const { mcpServerConfigSchema } = getMcpTaskDeps();
    return {
      type: "object",
      properties: {
        server: {
          oneOf: [
            { type: "string", format: "mcp-server" },
            {
              type: "object",
              format: "mcp-server",
              properties: mcpServerConfigSchema.properties,
              additionalProperties: false,
            },
          ],
          title: "Server",
          description: "MCP server reference (ID or inline config)",
        },
        ...mcpServerConfigSchema.properties,
        list_type: {
          type: "string",
          enum: mcpListTypes,
          title: "List Type",
          description: "The type of items to list from the MCP server",
        },
      },
      required: ["list_type"],
      allOf: mcpServerConfigSchema.allOf,
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
```

3. Update `execute()`:

```ts
  async execute(input: McpListTaskInput, context: IExecuteContext): Promise<McpListTaskOutput> {
    // Input resolver already resolved server ID to config object
    const serverConfig = getMcpServerConfig(input as Record<string, unknown>, undefined);

    const { mcpClientFactory } = getMcpTaskDeps();
    const { client } = await mcpClientFactory.create(serverConfig, context.signal);
```

- [ ] **Step 7: Run new tests to verify they pass**

Run: `cd packages/test && bun test mcp-server-registry`

Expected: All tests PASS

- [ ] **Step 8: Run ALL existing MCP tests to verify no regressions**

Run: `cd packages/test && bun test mcp`

Expected: All tests pass (existing 68 + new registry tests)

- [ ] **Step 9: Build to verify compilation**

Run: `bun run build:packages`

Expected: Clean build, no errors

- [ ] **Step 10: Commit**

```bash
git add packages/tasks/src/task/mcp/McpToolCallTask.ts \
       packages/tasks/src/task/mcp/McpPromptGetTask.ts \
       packages/tasks/src/task/mcp/McpResourceReadTask.ts \
       packages/tasks/src/task/mcp/McpListTask.ts \
       packages/test/src/test/mcp/mcp-server-registry.test.ts
git commit -m "feat(tasks): update MCP tasks to support server property with registry resolution"
```
