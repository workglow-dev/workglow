# MCP Support Improvement Plan

## Current State Summary

MCP support spans two repos with 16+ TypeScript files:

**workglow (libs)**:
- `@workglow/util/src/mcp/` — Client factories (node.ts + browser.ts), auth provider, auth types
- `@workglow/tasks/src/task/mcp/` — 4 task types: McpToolCallTask, McpListTask, McpResourceReadTask, McpPromptGetTask
- `@workglow/ai/` — AgentTask + ToolCallingTask use MCP tasks as agent tools
- SDK: `@modelcontextprotocol/sdk` v1.27.1

**workflow-builder (UI)**:
- 3 React hooks: useMcpTools, useMcpResources, useMcpPrompts
- 3 input editors + 3 property editors for MCP name/URI selection
- No MCP server management UI

---

## Phase 1 — Bug Fixes & Code Quality (P0)

### 1.1 Enable Error Handling in Node.ts

**Problem**: `McpClientUtil.node.ts` lines 147-181 have error handling for 405/406 HTTP errors commented out. `McpClientUtil.browser.ts` has identical error handling enabled. This means node/Bun users get raw, unhelpful errors when connecting to servers with transport mismatches.

**Files**: `packages/util/src/mcp/McpClientUtil.node.ts`

**Implementation**:
- Uncomment the try/catch block around `client.connect(transport)` (lines 147-181)
- This brings node.ts to parity with browser.ts
- Consider adding a hint to try `streamable-http` when `sse` fails with 405

### 1.2 Extract Shared Content Schemas

**Problem**: `McpToolCallTask.ts` and `McpPromptGetTask.ts` both define identical `annotationsSchema`, `contentSchema` (text/image/audio/resource/resource_link variants), and icon schemas. Any MCP spec update requires changing both files.

**Files**:
- Create: `packages/util/src/mcp/McpContentSchemas.ts`
- Modify: `packages/tasks/src/task/mcp/McpToolCallTask.ts`
- Modify: `packages/tasks/src/task/mcp/McpPromptGetTask.ts`

**Implementation**:
- Extract `annotationsSchema`, `toolContentSchema`, `contentSchema`, `iconSchema` into a shared module in `@workglow/util`
- Export as `const` objects with `satisfies DataPortSchema`
- Import in both task files instead of duplicating
- Also consider sharing `fallbackOutputSchema` patterns

### 1.3 Fix Hook Cache Key Inconsistency

**Problem**: `useMcpTools.ts` builds its cache key as `` `${transport}|${serverUrl}|${command}` `` but extracts `command` incorrectly or inconsistently vs. `useMcpResources.ts` and `useMcpPrompts.ts`. The hooks also have inconsistent transport handling logic.

**Files**:
- `workflow-builder/packages/app/src/hooks/useMcpTools.ts`
- `workflow-builder/packages/app/src/hooks/useMcpResources.ts`
- `workflow-builder/packages/app/src/hooks/useMcpPrompts.ts`

**Implementation**:
- Extract a shared `useMcpConnection(allValues)` hook or utility that:
  - Parses transport, server_url, command, args, env from allValues consistently
  - Builds a canonical cache key including all connection-relevant params
  - Provides `isReady` boolean (validates required params per transport type)
- Refactor all 3 hooks to use this shared utility
- Add cache invalidation when connection params change (currently cache is permanent)

### 1.4 Deduplicate Node/Browser Client Code

**Problem**: `McpClientUtil.node.ts` and `McpClientUtil.browser.ts` share ~80% identical code (auth resolution, header building, client creation, abort signal handling). Only transport instantiation differs.

**Files**:
- Create: `packages/util/src/mcp/McpClientUtilBase.ts`
- Modify: `packages/util/src/mcp/McpClientUtil.node.ts`
- Modify: `packages/util/src/mcp/McpClientUtil.browser.ts`

**Implementation**:
- Extract shared logic into `McpClientUtilBase.ts`:
  - `resolveAuthAndHeaders(config)` → returns `{ auth, authProvider, headers }`
  - `wrapClientWithSignal(client, signal)` → handles abort signal binding
  - `wrapClientConnect(client, transport, serverUrl)` → try/catch with 405/406 handling
- Platform-specific files only handle transport creation and `mcpTransportTypes`
- Re-export `McpServerConfig`, `mcpServerConfigSchema`, `mcpClientFactory` from platform files

---

## Phase 2 — Connection Management & Resilience (P1)

### 2.1 MCP Client Connection Pool

**Problem**: Every task execution creates a new connection. A workflow calling 10 tools on the same server opens/closes 10 connections. `McpToolCallTask.discoverSchemas()` calls `mcpList()` which opens yet another connection.

**Files**:
- Create: `packages/util/src/mcp/McpClientPool.ts`
- Modify: `packages/util/src/mcp/McpClientUtil.node.ts`
- Modify: `packages/util/src/mcp/McpClientUtil.browser.ts`
- Modify: `packages/tasks/src/task/mcp/McpToolCallTask.ts`
- Modify: `packages/tasks/src/task/mcp/McpListTask.ts`
- Modify: `packages/tasks/src/task/mcp/McpResourceReadTask.ts`
- Modify: `packages/tasks/src/task/mcp/McpPromptGetTask.ts`

**Implementation**:
```
McpClientPool {
  // Pool keyed by canonical server identity (transport + url/command + auth hash)
  private pools: Map<string, PoolEntry>

  // PoolEntry holds: client, transport, refCount, lastUsed, state
  interface PoolEntry {
    client: Client
    transport: Transport
    refCount: number
    lastUsed: number
    state: 'connecting' | 'connected' | 'closed'
  }

  acquire(config: McpServerConfig, signal?: AbortSignal): Promise<PooledClient>
  // Returns existing client if available, creates new one if not
  // Increments refCount

  release(client: PooledClient): void
  // Decrements refCount
  // If refCount === 0, starts idle timer (configurable, default 30s)
  // On idle timeout, closes connection

  closeAll(): Promise<void>
  // Closes all pooled connections
}
```

- `mcpClientFactory.create()` becomes `mcpClientPool.acquire()` / `.release()`
- Tasks use try/finally with `pool.release()` instead of `client.close()`
- Pool is a singleton per environment (global or workflow-scoped)
- `discoverSchemas()` benefits automatically — reuses the same connection
- Add `McpClientPool` as an optional injectable dependency (for testing)

### 2.2 Transport Auto-Detection with Fallback

**Problem**: Users must manually choose between `streamable-http` and `sse`. Many servers only support one or the other, and the error messages are confusing.

**Files**:
- Modify: `packages/util/src/mcp/McpClientUtil.node.ts`
- Modify: `packages/util/src/mcp/McpClientUtil.browser.ts`
- Modify: `packages/util/src/mcp/McpClientUtilBase.ts` (from 1.4)

**Implementation**:
- Add a new transport type: `"auto"` (default for HTTP-based connections)
- When transport is `"auto"`:
  1. Try `streamable-http` first
  2. On 405/406 error, fall back to `sse`
  3. On success, cache the working transport for this server URL
- Add `transportCache: Map<string, McpTransportType>` to skip re-detection
- Update `mcpServerConfigSchema` to include `"auto"` in enum
- Keep explicit `sse`/`streamable-http` options for users who know their server

### 2.3 Retry with Exponential Backoff

**Problem**: Failed MCP connections have no retry mechanism. Transient network errors cause immediate task failure.

**Files**:
- Create: `packages/util/src/mcp/McpRetry.ts`
- Modify: `packages/util/src/mcp/McpClientUtilBase.ts` (or platform files)

**Implementation**:
- Add retry wrapper: `withRetry(fn, options)` with configurable:
  - `maxRetries` (default: 3)
  - `baseDelay` (default: 1000ms)
  - `maxDelay` (default: 10000ms)
  - `retryableErrors` (network errors, 502/503/504, connection refused)
- Apply to `client.connect(transport)` in `createMcpClient()`
- Do NOT retry on 4xx client errors (except 429 rate limit)
- Respect `AbortSignal` during retry delays
- Emit retry events for logging/UI feedback

### 2.4 Connection Health Monitoring

**Problem**: No way to know if an MCP server is reachable before attempting to use it. The workflow builder has no connection status indicators.

**Files**:
- Add to: `packages/util/src/mcp/McpClientPool.ts` (from 2.1)
- Create: `workflow-builder/packages/app/src/hooks/useMcpConnectionStatus.ts`
- Create: `workflow-builder/packages/app/src/components/shared/McpConnectionStatus.tsx`

**Implementation**:
- `McpClientPool` tracks connection state per server: `connecting | connected | error | closed`
- Expose `getStatus(config)` method
- `useMcpConnectionStatus(config)` hook that:
  - Returns `{ status, error, lastConnected, reconnect }`
  - Subscribes to pool state changes
- `McpConnectionStatus` component: colored dot indicator (green/yellow/red)
- Integrate into MCP task property editors in workflow-builder

---

## Phase 3 — Missing MCP Spec Features (P1)

### 3.1 Pagination Support for List Operations

**Problem**: `McpListTask` calls `client.listTools()` etc. without handling pagination. Servers with many tools/resources will only return the first page.

**Files**:
- Modify: `packages/tasks/src/task/mcp/McpListTask.ts`

**Implementation**:
- After initial list call, check for `nextCursor` in result
- While `nextCursor` exists, call `client.listTools({ cursor: nextCursor })` and accumulate results
- Apply same pattern to `listResources()` and `listPrompts()`
- Add optional `maxPages` config to prevent infinite pagination (default: 10)
- This also fixes `discoverSchemas()` in McpToolCallTask/McpPromptGetTask which call `mcpList()` internally

### 3.2 Resource Templates Support

**Problem**: MCP spec supports resource templates (`uri_template` with RFC 6570 URI templates) for parameterized resources. Currently not supported.

**Files**:
- Modify: `packages/tasks/src/task/mcp/McpListTask.ts` (add `list_type: "resource_templates"`)
- Create: `packages/tasks/src/task/mcp/McpResourceTemplateReadTask.ts`
- Modify: `workflow-builder/packages/app/src/hooks/useMcpResources.ts`
- Create: `workflow-builder/packages/app/src/components/shared/input-editors/McpResourceTemplateEditor.tsx`

**Implementation**:
- Add `"resource_templates"` to `mcpListTypes` enum
- Add `outputSchemaResourceTemplates` with `uriTemplate`, `name`, `description`, `mimeType`
- `McpResourceTemplateReadTask`:
  - Config: server config + `uri_template` (string)
  - Input: template parameters (dynamic schema discovered from template variables)
  - Expands URI template with input values using RFC 6570 library
  - Calls `client.readResource()` with expanded URI
- UI: Template parameter form that shows template variables as input fields

### 3.3 Server Notification Handling

**Problem**: MCP servers can send notifications (tool list changed, resource updated, etc.) but the client ignores them.

**Files**:
- Modify: `packages/util/src/mcp/McpClientPool.ts` (from 2.1)
- Modify: `packages/util/src/mcp/McpClientUtilBase.ts`

**Implementation**:
- Register notification handlers on the Client:
  - `notifications/tools/list_changed` → invalidate cached tool list, emit event
  - `notifications/resources/list_changed` → invalidate cached resource list, emit event
  - `notifications/resources/updated` → emit event with resource URI
  - `notifications/prompts/list_changed` → invalidate cached prompt list, emit event
- Expose notification events from `McpClientPool` via EventEmitter pattern
- workflow-builder hooks can subscribe to these events to auto-refresh lists
- This is essential for long-lived connections in the pool (Phase 2.1)

### 3.4 Resource Subscriptions

**Problem**: MCP spec supports subscribing to resource changes, but no subscription support exists.

**Files**:
- Create: `packages/tasks/src/task/mcp/McpResourceSubscribeTask.ts`
- Modify: `packages/util/src/mcp/McpClientPool.ts`

**Implementation**:
- `McpResourceSubscribeTask`:
  - Config: server config + resource URI
  - Input: empty
  - Output: reactive stream of resource updates
  - Uses `client.subscribe({ uri })` and listens for `notifications/resources/updated`
  - Integrates with `executeReactive()` for streaming task output
- Requires long-lived connections (depends on 2.1 connection pool)
- Add `client.unsubscribe({ uri })` on task disposal

---

## Phase 4 — MCP Server Implementation (P1)

### 4.1 Expose Tasks as MCP Tools (Server-Side)

**Problem**: Currently only MCP client. No way to expose workglow tasks/workflows as MCP tools for external consumers (Claude Desktop, Cursor, other MCP clients).

**Files**:
- Create: `packages/util/src/mcp/McpServerUtil.ts`
- Create: `packages/tasks/src/task/mcp/McpServerTask.ts` (or standalone)

**Implementation**:
```
McpTaskServer {
  constructor(options: {
    name: string
    version: string
    tasks: Array<typeof Task>       // Task classes to expose as tools
    transport: 'stdio' | 'sse' | 'streamable-http'
    port?: number                    // for HTTP transports
  })

  // Auto-generates MCP tool definitions from Task metadata:
  // - task.type → tool name
  // - task.description → tool description
  // - task.inputSchema() → tool inputSchema
  // - task.outputSchema() → tool outputSchema (structured output)
  // - task.configSchema() → can be exposed or pre-configured

  start(): Promise<void>
  stop(): Promise<void>
}
```

- Uses `@modelcontextprotocol/sdk/server` (Server class)
- Maps `server.setRequestHandler(ListToolsRequestSchema, ...)` to TaskRegistry
- Maps `server.setRequestHandler(CallToolRequestSchema, ...)` to task execution
- Tool annotations derived from Task static properties:
  - `cacheable` → `readOnlyHint: true`
  - `customizable` → tool has config parameters
- Support both stdio (for Claude Desktop) and HTTP transports

### 4.2 Expose Workflows as MCP Tools

**Problem**: Individual tasks are useful, but composed workflows (multi-step DAG pipelines) are more powerful.

**Files**:
- Extend: `packages/util/src/mcp/McpServerUtil.ts` (from 4.1)

**Implementation**:
- Add `workflows` option to `McpTaskServer` constructor
- Each named workflow becomes a single MCP tool:
  - Tool name = workflow name
  - Input schema = workflow's external input schema
  - Output schema = workflow's external output schema
- Workflow execution happens server-side when tool is called
- Support progress notifications during long-running workflows
- Support cancellation via MCP's cancellation mechanism

### 4.3 Expose Resources and Prompts

**Files**:
- Extend: `packages/util/src/mcp/McpServerUtil.ts`

**Implementation**:
- Allow registering static resources (files, data) exposed via MCP
- Allow registering prompt templates
- Support resource templates backed by workflow data sources
- Map workflow knowledge-base entries to MCP resources

---

## Phase 5 — Workflow Builder UI Improvements (P1)

### 5.1 MCP Server Configuration Manager

**Problem**: No UI to add, edit, or manage MCP server connections. Configs must be manually provided.

**Files**:
- Create: `workflow-builder/packages/app/src/stores/mcpServerStore.ts`
- Create: `workflow-builder/packages/app/src/components/settings/McpServerManager.tsx`
- Create: `workflow-builder/packages/app/src/components/settings/McpServerForm.tsx`

**Implementation**:
- `mcpServerStore`: Zustand store (or similar) for named MCP server configs
  - CRUD operations for server configs
  - Persist to localStorage or app settings
  - Each config: `{ name, transport, server_url?, command?, args?, env?, auth? }`
- `McpServerManager`: Settings page/panel listing configured servers
  - Add/edit/delete servers
  - Test connection button
  - Connection status indicators (from 2.4)
- `McpServerForm`: Form for editing server config
  - Transport type selector
  - Conditional fields (URL vs command/args)
  - Auth type selector with conditional fields
  - Test connection button
- MCP task editors reference named servers instead of inline config

### 5.2 MCP Server Selector in Task Editors

**Problem**: MCP task editors require inline server config entry. Should be able to select from pre-configured servers.

**Files**:
- Create: `workflow-builder/packages/app/src/components/shared/input-editors/McpServerSelector.tsx`
- Modify: All 6 MCP input/property editors

**Implementation**:
- `McpServerSelector` dropdown that lists named servers from `mcpServerStore`
- On selection, populates transport/server_url/command/args/env/auth fields
- Option to "Use custom config" for inline entry
- Replaces the need for users to re-enter server config per task node

### 5.3 Enhanced Tool/Resource/Prompt Browsers

**Problem**: Current editors show basic name/description. No way to see schemas, test tools, or browse details.

**Files**:
- Create: `workflow-builder/packages/app/src/components/shared/McpToolBrowser.tsx`
- Modify: existing input/property editors

**Implementation**:
- `McpToolBrowser`: Modal/panel for browsing MCP server capabilities
  - Tabbed view: Tools | Resources | Prompts
  - Tool detail view: input/output schema, annotations, test invocation
  - Resource detail view: URI, MIME type, preview content
  - Prompt detail view: arguments, preview with sample values
- Integrate into existing editors as "Browse..." button
- Support pagination (depends on 3.1)

---

## Phase 6 — Advanced Features (P2)

### 6.1 MCP Sampling/Completion Support

**Problem**: MCP spec supports servers requesting LLM completions from the client, enabling agentic server-side workflows. Not implemented.

**Files**:
- Modify: `packages/util/src/mcp/McpClientUtilBase.ts`
- Modify: `packages/ai/src/task/AgentTask.ts`

**Implementation**:
- Register `sampling/createMessage` request handler on Client
- Route sampling requests to the AI provider configured in the workflow
- Requires the AgentTask (or workflow context) to provide a callback
- Add `samplingProvider` option to `McpServerConfig`

### 6.2 MCP Elicitation Support

**Problem**: MCP spec (2025-06-18) introduced elicitation — servers can request structured input from users during tool execution. Not implemented.

**Files**:
- Modify: `packages/util/src/mcp/McpClientUtilBase.ts`
- Create: `workflow-builder/packages/app/src/components/shared/McpElicitationDialog.tsx`

**Implementation**:
- Register `elicitation/create` request handler on Client
- In workflow-builder: show modal dialog with dynamically generated form from elicitation schema
- In headless/CI: auto-respond with defaults or fail
- Route user responses back to server

### 6.3 MCP Tool Execution Progress

**Problem**: Long-running MCP tool calls show no progress. MCP spec supports progress notifications.

**Files**:
- Modify: `packages/tasks/src/task/mcp/McpToolCallTask.ts`
- Modify: `packages/util/src/mcp/McpClientUtilBase.ts`

**Implementation**:
- Pass `_meta.progressToken` in tool call requests
- Listen for `notifications/progress` from server
- Map progress notifications to task progress events
- workflow-builder can show progress bars for MCP tool executions

### 6.4 Schema Caching & Offline Mode

**Problem**: Schema discovery requires a live server connection. If the server is down, tasks can't determine their schemas.

**Files**:
- Create: `packages/util/src/mcp/McpSchemaCache.ts`
- Modify: `packages/tasks/src/task/mcp/McpToolCallTask.ts`
- Modify: `packages/tasks/src/task/mcp/McpPromptGetTask.ts`

**Implementation**:
- Cache discovered tool/resource/prompt schemas keyed by server+name
- Persist cache to storage (ICredentialStore or similar)
- Use cached schemas when server is unreachable
- Invalidate on `notifications/tools/list_changed` (from 3.3)
- TTL-based invalidation as fallback

---

## Dependency Graph

```
Phase 1 (no dependencies — do first)
  1.1 Enable error handling
  1.2 Extract shared schemas
  1.3 Fix hook cache keys
  1.4 Deduplicate client code

Phase 2 (1.4 should come first)
  2.1 Connection pool ← depends on 1.4
  2.2 Transport auto-detect ← depends on 1.1, 1.4
  2.3 Retry logic ← depends on 1.4
  2.4 Health monitoring ← depends on 2.1

Phase 3 (2.1 should come first for notifications/subscriptions)
  3.1 Pagination ← independent
  3.2 Resource templates ← independent
  3.3 Notifications ← depends on 2.1
  3.4 Subscriptions ← depends on 2.1, 3.3

Phase 4 (independent of 2/3)
  4.1 Server: tasks as tools ← independent
  4.2 Server: workflows as tools ← depends on 4.1
  4.3 Server: resources/prompts ← depends on 4.1

Phase 5 (partially depends on 2.4)
  5.1 Server config manager ← independent
  5.2 Server selector ← depends on 5.1
  5.3 Tool browser ← depends on 3.1

Phase 6 (advanced, depends on pool)
  6.1 Sampling ← depends on 2.1
  6.2 Elicitation ← depends on 2.1
  6.3 Progress ← depends on 2.1
  6.4 Schema caching ← depends on 3.3
```

## Recommended Execution Order

1. **Phase 1** (all items in parallel) — immediate code quality wins
2. **Phase 2.1** (connection pool) — foundational for everything else
3. **Phase 2.2 + 2.3** (auto-detect + retry) — resilience
4. **Phase 3.1** (pagination) — quick spec compliance win
5. **Phase 4.1** (MCP server) — high-value new capability
6. **Phase 3.3 + 3.4** (notifications + subscriptions) — leverage the pool
7. **Phase 5.1 + 5.2** (server management UI) — user experience
8. **Phase 3.2** (resource templates)
9. **Phase 4.2 + 4.3** (server: workflows + resources)
10. **Phase 2.4 + 5.3** (health monitoring + tool browser)
11. **Phase 6** (advanced features as needed)
