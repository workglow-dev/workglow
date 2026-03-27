# MCP Server Registry Design

Centralized registry for MCP server configurations, allowing tasks to reference pre-configured servers by ID instead of requiring inline connection details.

## Architecture

Dual-layer pattern following the KnowledgeBase model:

1. **McpServerRepository** (shared, persistent) -- stores server config records in tabular storage. Shared across all workflows.
2. **McpServerRegistry** (scoped, live) -- `Map<string, McpServerConnection>` holding live connection state. Lives in the `ServiceRegistry`, so different scopes (per-workflow, per-graph-run) get independent connection maps.

For the initial implementation, the live connection map exists structurally but tasks continue the current connect-per-execute pattern. Connection reuse/pooling is a future enhancement.

## New Files

All new files in `packages/tasks/src/mcp-server/`:

### McpServerSchema.ts

Defines the storage schema and types.

```ts
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

### McpServerRepository.ts

Repository class wrapping `ITabularStorage`. Follows `KnowledgeBaseRepository` pattern exactly.

- Events: `server_added`, `server_removed`, `server_updated`
- Methods: `addServer(record)`, `removeServer(server_id)`, `getServer(server_id)`, `enumerateAll()`, `size()`
- Constructor takes `ITabularStorage<McpServerRecordSchema, McpServerPrimaryKeyNames>`

### InMemoryMcpServerRepository.ts

One-liner:

```ts
export class InMemoryMcpServerRepository extends McpServerRepository {
  constructor() {
    super(new InMemoryTabularStorage(McpServerRecordSchema, McpServerPrimaryKeyNames));
  }
}
```

### McpServerRegistry.ts

Dual service tokens + input resolver. Follows `KnowledgeBaseRegistry.ts` pattern.

```ts
// Live connection map (scoped per ServiceRegistry)
export const MCP_SERVERS = createServiceToken<Map<string, McpServerConnection>>(
  "mcp-server.registry"
);

// Persistent config storage (shared)
export const MCP_SERVER_REPOSITORY = createServiceToken<McpServerRepository>(
  "mcp-server.repository"
);
```

Where `McpServerConnection` is:

```ts
export interface McpServerConnection {
  readonly config: McpServerRecord;
  // Future: client, transport, connection state
}
```

Functions:

- `getGlobalMcpServers()` -- returns the live Map
- `getGlobalMcpServerRepository()` / `setGlobalMcpServerRepository(repo)` -- persistent config
- `registerMcpServer(id, config)` -- adds to both live Map and repository
- `getMcpServer(id)` -- looks up from live Map
- `resolveServerFromRegistry(id, format, registry)` -- input resolver function, returns the config record. Checks scoped registry first, falls back to global.
- `registerInputResolver("mcp-server", resolveServerFromRegistry)` -- wires it up

Default factories registered on `globalServiceRegistry` for both tokens (InMemory defaults).

## Task Changes

### Config-based tasks (McpToolCallTask, McpPromptGetTask, McpResourceReadTask)

Each task's `configSchema()` gains a `server` property supporting both string ID and inline object:

```ts
server: {
  oneOf: [
    { type: "string", format: "mcp-server" },
    {
      type: "object",
      format: "mcp-server",
      properties: { ...mcpServerConfigSchema.properties },
      additionalProperties: false,
    },
  ],
  title: "Server",
  description: "MCP server reference (ID or inline config)",
},
```

`transport` is no longer in the `required` array -- it can come from the resolved server config.

Validation changes: the `if/then/else` for transport-dependent required fields is adjusted so that when `server` is provided, transport-specific fields are not required at the config level.

### Input-based task (McpListTask)

McpListTask takes server config as **input** (not config). Its `inputSchema()` gains the same `server` property. Since inputs are already resolved by `resolveSchemaInputs` in TaskRunner, the string-to-config resolution happens automatically.

`transport` is no longer required when `server` is provided.

### getMcpServerConfig() helper

Shared utility in `packages/tasks/src/mcp-server/McpServerConfig.ts` (or similar):

```ts
export function getMcpServerConfig(
  configOrInput: Record<string, unknown>,
  resolvedConfig: Readonly<Record<string, unknown>> | undefined
): McpServerConfig
```

Merges resolved server config with inline overrides:

1. Start with resolved `server` value (if it's an object/record after resolution)
2. Overlay any explicit inline properties from the task config (transport, server_url, command, args, env, auth fields) -- only non-undefined values override
3. Validate that a `transport` is available from one source
4. Return `McpServerConfig`

Each MCP task calls this in `execute()`:

```ts
// Config-based tasks:
const serverConfig = getMcpServerConfig(this.config, context.resolvedConfig);

// McpListTask (input-based):
const serverConfig = getMcpServerConfig(input, undefined);
// (server already resolved in input by TaskRunner's resolveSchemaInputs)
```

## TaskRunner Changes

### IExecuteContext addition

```ts
export interface IExecuteContext {
  // ... existing fields ...
  resolvedConfig?: Readonly<Record<string, unknown>>;
}
```

### Config resolution in TaskRunner.run()

After `handleStart()` and before input resolution, resolve config schema format annotations:

```ts
// Resolve config schema annotations without mutating this.task.config
const configSchema = (this.task.constructor as typeof Task).configSchema();
const resolvedConfig = await resolveSchemaInputs(
  { ...this.task.config } as Record<string, unknown>,
  configSchema,
  { registry: this.registry }
);
```

The `resolvedConfig` is passed through to the `IExecuteContext` in `executeTask()`, `executeStreamingTask()`, and `executeTaskReactive()`. The original `this.task.config` is never mutated.

Same treatment in `runReactive()`.

## Exports

New exports from `packages/tasks/src/common.ts`:
- `McpServerRecordSchema`, `McpServerRecord`, `McpServerPrimaryKeyNames`
- `McpServerRepository`
- `InMemoryMcpServerRepository`
- `McpServerConnection`, `MCP_SERVERS`, `MCP_SERVER_REPOSITORY`
- `getGlobalMcpServers`, `getGlobalMcpServerRepository`, `setGlobalMcpServerRepository`
- `registerMcpServer`, `getMcpServer`
- `getMcpServerConfig`

These have no platform-specific code, so they export from `common.ts` (not browser/node/bun).

## Tests

New test file: `packages/test/src/test/mcp/mcp-server-registry.test.ts`

### Repository tests
- Add/remove/get/enumerate server records
- Event emission (server_added, server_removed)
- Duplicate ID overwrites
- Remove nonexistent ID throws

### Registry tests
- registerMcpServer adds to both Map and repository
- getMcpServer returns from Map
- Scoped registries are independent (different ServiceRegistry instances)

### Input resolver tests
- String server ID resolves to config record
- Unknown ID throws
- Non-string values pass through unchanged
- Scoped registry takes precedence over global

### Task integration tests
- McpToolCallTask with `server: "my-server"` in config resolves and connects
- McpToolCallTask with inline server object in config works
- McpListTask with `server: "my-server"` in input resolves and connects
- Inline config values override registry values (e.g., registry has transport "sse", config overrides to "streamable-http")
- Task works with server only (no inline transport/url)
- Task works with inline only (no server reference, backward compatible)

### TaskRunner config resolution tests
- resolvedConfig is populated in IExecuteContext
- Original task.config is not mutated
- Config resolution handles format annotations

## Migration / Backward Compatibility

All existing task usage continues to work unchanged. The `server` property is optional. If not provided, tasks behave exactly as before (inline transport/server_url/command required). No breaking changes.
