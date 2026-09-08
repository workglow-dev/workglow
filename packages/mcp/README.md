# @workglow/mcp

Model Context Protocol tasks and plumbing for Workglow.

## Features

- Model Context Protocol (MCP) integration for Workglow
- Tasks for interacting with MCP servers (`./tasks`)
- Utilities for plumbing MCP into task graphs (`./util`)
- Hosting an MCP server whose tools are registered tasks (`./server`)

## Installation

```bash
npm install @workglow/mcp
# or
bun add @workglow/mcp
# or
yarn add @workglow/mcp
```

## Usage

```typescript
import { McpCallToolTask } from "@workglow/mcp/tasks";
import { Workflow } from "@workglow/task-graph";

const workflow = new Workflow();
workflow.addTask(McpCallToolTask, {
  server: "my-server",
  toolName: "my-tool",
  arguments: { arg1: "value" },
});

await workflow.run();
```

### Serving tasks as MCP tools

`./server` is the other direction: registered tasks offered to MCP clients as
tools. `createTaskMcpServer` is transport-agnostic — one tool per task type,
the task's input schema as the tool's arguments, its output as the result —
and the HTTP pieces around it are separate so a host can take only what it
needs.

```typescript
import { createTaskMcpServer, generateBearerToken, startMcpHttpServer } from "@workglow/mcp/server";

const handle = await startMcpHttpServer({
  port: 8788,
  host: "127.0.0.1",
  // `undefined` serves unauthenticated, which is a decision, never a default.
  token: generateBearerToken(),
  createServer: () => createTaskMcpServer({ name: "my-app", version: "1.0.0" }),
});
console.log(handle.url, handle.token);
```

A host with its own web framework skips `startMcpHttpServer` and keeps the two
pieces under it: `McpSessionRouter` holds the Streamable HTTP sessions across
requests, and `authorizeBearer` is the token check.

```typescript
import { McpSessionRouter } from "@workglow/mcp/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

const router = new McpSessionRouter({
  createTransport: (hooks) => new WebStandardStreamableHTTPServerTransport(hooks),
  createServer: () => createTaskMcpServer({ name: "my-app", version: "1.0.0" }),
});
```

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.
