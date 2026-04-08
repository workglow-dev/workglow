<!--
@license
Copyright 2025 Steven Roussey <sroussey@gmail.com>
SPDX-License-Identifier: Apache-2.0
-->

# MCP Integration in Workglow: Turning Every AI Tool Into a Pipeline Node

The promise of AI agents has always been about more than just generating text. Real utility comes from *doing things* -- calling APIs, reading files, querying databases, running code. But every tool integration has historically been a bespoke affair: hand-rolled adapters, custom authentication, brittle connection management. The Model Context Protocol (MCP) changes that equation, and Workglow's integration with it goes further still.

This post explores how Workglow treats MCP not as an external add-on but as a first-class citizen in its task pipeline architecture -- where every MCP operation is a composable, type-safe, entitlement-guarded node in a directed acyclic graph.

---

## What Is MCP?

The Model Context Protocol is a standardized interface for AI systems to interact with external tools, resources, and prompts. Think of it as a universal adapter layer: instead of writing a different integration for every service your AI needs to reach, MCP defines a common vocabulary.

An MCP server exposes three primitives:

- **Tools** -- callable functions with typed input/output schemas (e.g., "search the web," "create a GitHub issue," "query a database")
- **Resources** -- readable data identified by URIs (e.g., files, database records, configuration blobs)
- **Prompts** -- reusable prompt templates with typed arguments

Clients connect over one of three transports: **stdio** (for local processes), **SSE** (Server-Sent Events), or **Streamable HTTP** (the newest, most capable transport). The protocol handles capability negotiation, schema discovery, and structured responses.

What makes MCP compelling is its ecosystem. The [MCP Registry](https://registry.modelcontextprotocol.io) already catalogs hundreds of servers -- from Slack and GitHub to weather APIs and local file systems. Any of these can be discovered, configured, and used at runtime.

---

## MCP as Composable Tasks

Workglow's core abstraction is the task: a typed unit of work with declared input/output schemas that fits into a DAG pipeline. The design question for MCP integration was never *whether* to support it but *how deeply to embed it*.

The answer: every MCP operation is a task class. Not a wrapper. Not a plugin. A full `Task` subclass with static type metadata, JSON Schema declarations, entitlement requirements, and workflow builder integration.

There are five MCP task types:

| Task | Purpose |
|------|---------|
| `McpToolCallTask` | Invokes a tool on an MCP server |
| `McpPromptGetTask` | Retrieves and executes a prompt template |
| `McpResourceReadTask` | Reads a resource by URI |
| `McpListTask` | Discovers available tools, resources, or prompts |
| `McpSearchTask` | Searches the public MCP registry for servers |

Each one follows the same contract as any other Workglow task. They have `inputSchema()` and `outputSchema()` methods. They declare `entitlements()`. They implement `execute()`. They can be chained with `pipe()`, run in `parallel()`, or nested inside `GraphAsTask` subgraphs.

This means a pipeline can seamlessly mix MCP calls with AI inference, data transformations, and storage operations:

```ts
const workflow = new Workflow({ name: "research-pipeline" });

workflow
  .mcpToolCall({
    server: { transport: "streamable-http", server_url: "https://search-server.example.com" },
    tool_name: "web_search",
  })
  .pipe(
    workflow.textGeneration({
      model: "claude-sonnet-4-20250514",
      prompt: "Summarize these search results:",
    })
  );

await workflow.run({ query: "Model Context Protocol specification" });
```

The Workflow builder even gets augmented prototypes -- `workflow.mcpToolCall(...)`, `workflow.mcpList(...)`, and so on -- so MCP operations have the same ergonomics as built-in tasks.

---

## The Server Registry

Managing MCP server connections across a complex pipeline requires more than just passing URLs around. Workglow provides a layered registry system.

### The In-Memory Map

At the base level, `MCP_SERVERS` is a service token pointing to a `Map<string, McpServerConnection>`. When you call `registerMcpServer(config)`, the server configuration is stored here and simultaneously persisted to the repository. At runtime, tasks that reference a server by ID resolve it from this map.

### McpServerRepository

For persistent storage, `McpServerRepository` wraps an `ITabularStorage` backend. The default `InMemoryMcpServerRepository` works out of the box, but the architecture supports SQLite, PostgreSQL, or any other storage backend in the Workglow ecosystem. The repository emits events -- `server_added`, `server_removed`, `server_updated` -- so UI layers or monitoring systems can react to configuration changes.

### Format-Based Resolution

The schema system ties it all together. When a task declares a `server` property with `format: "mcp-server"`, Workglow's input resolver knows how to look up the server by ID:

```ts
// In a task's config schema:
server: TypeMcpServer(mcpServerConfigSchema)
// This creates a oneOf: either a string (server ID) or an inline config object
```

The resolver checks the scoped service registry first (for per-workflow overrides), falls back to the global map, then queries the repository. A corresponding compactor extracts the `server_id` from resolved objects for serialization. This two-way resolution means pipelines can reference servers by name in their serialized form while resolving to full configuration at execution time.

---

## Available MCP Tasks in Detail

### McpToolCallTask -- The Workhorse

The most commonly used MCP task. It calls a named tool on a server and returns the result. What sets it apart is **dynamic schema discovery**: when a `McpToolCallTask` is created without explicit `inputSchema` or `outputSchema`, it will query the server's tool listing to discover the schemas at runtime.

```ts
const task = new McpToolCallTask({
  server: { transport: "stdio", command: "npx", args: ["-y", "@mcp/weather-server"] },
  tool_name: "get_forecast",
});
// Schemas are discovered automatically before execution
const result = await task.run({ location: "San Francisco", days: 3 });
```

The task also handles **structured content** intelligently. When a server returns `structuredContent` (the MCP spec's typed output), those fields are spread into the output. When only text content is returned and it looks like JSON, the task attempts to parse it. This flexibility means downstream tasks get clean, typed data regardless of the server's sophistication.

### McpListTask -- Discovery at Runtime

Lists tools, resources, or prompts from a server. The output schema dynamically narrows based on the `list_type` input -- if you ask for `"tools"`, the output schema only includes the `tools` array property. This dynamic schema behavior means downstream dataflow connections stay type-safe even when the list type is determined at runtime.

### McpPromptGetTask -- Reusable Prompt Templates

Retrieves a prompt template from a server and executes it with the provided arguments. Like `McpToolCallTask`, it performs schema discovery to learn the prompt's expected arguments. The output includes the rendered messages and an optional description, ready to feed directly into a text generation task.

### McpResourceReadTask -- Accessing Data

Reads a resource by URI. Resources can contain text or binary data (base64-encoded blobs), identified by MIME type. This task is ideal for pulling configuration, documents, or data files from MCP servers into a pipeline.

### McpSearchTask -- Finding Servers

Searches the public MCP Registry at `registry.modelcontextprotocol.io`. Given a query string, it returns server entries with their installation configurations already mapped to Workglow's format -- including the correct `command` and `args` for npm, PyPI, or OCI packages. This powers the CLI's `mcp find` command and enables programmatic server discovery.

---

## Authentication: From Bearer Tokens to Private Key JWTs

MCP servers in the real world are not all open endpoints. Workglow supports six authentication modes, each modeled as a variant in a discriminated union (`McpAuthConfig`):

- **`none`** -- No authentication needed
- **`bearer`** -- Static token in the `Authorization` header
- **`client_credentials`** -- OAuth 2.0 client credentials flow
- **`private_key_jwt`** -- JWT signed with a private key for client authentication
- **`static_private_key_jwt`** -- Pre-built JWT assertion
- **`authorization_code`** -- Full OAuth 2.0 authorization code flow with PKCE

The `CredentialStoreOAuthProvider` class bridges the MCP SDK's `OAuthClientProvider` interface with Workglow's `ICredentialStore`. Tokens, client information, PKCE code verifiers, and discovery state are all persisted under namespaced keys derived from the server URL. This means a short-lived MCP connection can pick up tokens from a previous session without re-authenticating.

Secrets are resolved through the credential store at execution time. Auth config fields marked with `format: "credential"` in the schema are automatically looked up from the store. The `resolveAuthSecrets` function handles this for standalone task execution paths, while the pipeline's built-in `resolveSchemaInputs` handles it for tasks running inside a workflow.

This layered approach means sensitive values never need to appear in pipeline definitions. A config can reference `"my-api-key"` as a credential store key, and the actual secret is resolved only at the moment of connection.

---

## Client Utilities: Connection Management

The `McpClientUtil` module provides the transport-level plumbing. It builds the correct transport based on the config:

- **stdio** -- Delegated to a platform-injected factory (Node/Bun only; browser builds exclude it entirely)
- **SSE** -- Uses `SSEClientTransport` from the MCP SDK
- **Streamable HTTP** -- Uses `StreamableHTTPClientTransport` for bidirectional streaming

Each task creates a client, performs its operation, and closes the connection in a `try/finally` block. The factory pattern (`mcpClientFactory`) makes the client creation mockable for testing -- the test suite swaps it out with mock clients that return predefined responses.

Abort signal propagation is built in: if a pipeline is cancelled, the signal triggers `client.close()` on all active MCP connections.

Platform-specific concerns are handled through `McpTaskDeps`, a dependency injection token. Browser builds register a deps object without stdio support; Node and Bun builds include it. This means the same task code runs everywhere, and the transport enum in the schema adjusts to exclude unsupported options.

---

## Entitlements: Security as a First-Class Concern

Workglow's entitlement system provides declarative security controls for task execution. MCP tasks declare exactly what capabilities they require, and the runtime can enforce policies before any code runs.

The MCP-specific entitlements form a hierarchy:

```
mcp                    -- Base MCP entitlement (covers all MCP operations)
  mcp:tool-call        -- Permission to call tools on MCP servers
  mcp:resource-read    -- Permission to read resources
  mcp:prompt-get       -- Permission to retrieve prompts
  mcp:stdio            -- Permission to spawn local processes via stdio transport
```

Each task class declares its entitlements both statically (for policy analysis before execution) and per-instance (for runtime checks). The instance-level `entitlements()` method can add `MCP_STDIO` when the configured transport is `stdio`, since spawning a subprocess is a materially different security posture than making an HTTP request.

Optional entitlements like `NETWORK` and `CREDENTIAL` signal that the task *may* need these capabilities depending on configuration. A policy engine can use this information to require user approval for pipelines that reach out to the network or access stored credentials.

The hierarchical structure means a broad grant of `"mcp"` covers all MCP operations, while a narrower grant of `"mcp:resource-read"` permits only resource access. Combined with the `resources` field on entitlement grants (which supports glob patterns), administrators can craft fine-grained policies: "allow MCP tool calls, but only to servers matching `*.internal.company.com`."

---

## Pipeline Integration: Where It All Comes Together

The real power of Workglow's MCP integration is not in any single task but in how naturally these tasks compose with everything else in the system.

Consider a RAG pipeline that uses MCP to search the web, processes results through an AI model, and stores the output in a knowledge base:

```ts
const workflow = new Workflow({ name: "mcp-rag-pipeline" });

// Step 1: Search using an MCP server
const search = workflow.mcpToolCall({
  server: "web-search-server",  // Resolved from registry
  tool_name: "search",
});

// Step 2: Summarize results with AI
const summarize = workflow.textGeneration({
  model: "claude-sonnet-4-20250514",
});

// Step 3: Chunk and embed for RAG
const chunk = workflow.chunkText({ strategy: "semantic" });
const embed = workflow.chunkToVector({ model: "text-embedding-3-small" });
const store = workflow.chunkVectorUpsert({ knowledgeBase: "research-kb" });

workflow.pipe(search, summarize, chunk, embed, store);
await workflow.run({ query: "latest developments in AI safety" });
```

Each node in this pipeline is a typed task with schema-validated dataflow connections. The MCP search results flow into the AI summarizer, which flows into the chunker, which flows into the embedder, which flows into the vector store. If any MCP server requires authentication, it is resolved transparently. If the pipeline is cancelled mid-flight, all connections are cleaned up. If entitlements are not granted, execution fails fast with a clear error.

The `McpElicitationConnector` takes this integration even further: when Workglow itself is running *as* an MCP server, human-in-the-loop interactions can be routed through MCP's elicitation protocol. Notifications, content display, and structured form input all work through the same `IHumanConnector` interface, whether the consumer is a local UI or a remote MCP client.

---

## Looking Forward

MCP is still a young protocol, but its trajectory is clear: it is becoming the standard interface between AI systems and the tools they use. Workglow's deep integration -- treating every MCP operation as a typed, composable, security-aware pipeline node -- positions it to take full advantage of this ecosystem as it grows.

The MCP Registry already has hundreds of servers. Each one is a potential node in a Workglow pipeline. Each one inherits the same entitlement guards, authentication handling, and lifecycle management as any native task. That is not just integration. That is interoperability by design.
