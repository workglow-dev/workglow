/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Node/Bun MCP client util. Supports stdio, sse, and streamable-http.
 * stdio is not available in the browser.
 */

import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// eslint-disable-next-line deprecation/deprecation
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { DataPortSchemaObject } from "../json-schema/DataPortSchema.js";
import { getGlobalCredentialStore } from "../credentials/CredentialStoreRegistry";
import { mcpAuthConfigSchema, buildAuthConfig } from "./McpAuthTypes";
import type { McpAuthConfig } from "./McpAuthTypes";
import { createAuthProvider, resolveAuthSecrets } from "./McpAuthProvider";
import { getLogger } from "../logging/LoggerRegistry";

export const mcpTransportTypes = ["stdio", "sse", "streamable-http"] as const;

export const mcpServerConfigSchema = {
  transport: {
    type: "string",
    enum: mcpTransportTypes,
    title: "Transport",
    description: "The transport type to use for connecting to the MCP server",
  },
  server_url: {
    type: "string",
    format: "string:uri",
    title: "Server URL",
    description: "The URL of the MCP server (for sse and streamable-http transports)",
  },
  command: {
    type: "string",
    title: "Command",
    description: "The command to run (for stdio transport)",
  },
  args: {
    type: "array",
    items: { type: "string" },
    title: "Arguments",
    description: "Command arguments (for stdio transport)",
  },
  env: {
    type: "object",
    additionalProperties: { type: "string" },
    title: "Environment",
    description: "Environment variables (for stdio transport)",
  },
  ...mcpAuthConfigSchema,
} as const satisfies DataPortSchemaObject["properties"];

export type McpTransportType = (typeof mcpTransportTypes)[number];

export interface McpServerConfig {
  transport: McpTransportType;
  server_url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  auth?: McpAuthConfig;
  // Flat auth properties from schema (used when config comes from JSON Schema forms)
  auth_type?: string;
}

export async function createMcpClient(
  config: McpServerConfig,
  signal?: AbortSignal
): Promise<{ client: Client; transport: Transport }> {
  let transport: Transport;

  // Resolve auth config: prefer structured `auth` object, fall back to flat props
  let auth: McpAuthConfig | undefined =
    config.auth ?? buildAuthConfig({ ...config });

  // Resolve credential store keys to actual secret values
  if (auth && auth.type !== "none") {
    auth = await resolveAuthSecrets(auth, getGlobalCredentialStore());
  }

  // Build auth provider for OAuth flows
  const authProvider =
    auth && auth.type !== "none" && auth.type !== "bearer"
      ? createAuthProvider(auth, config.server_url ?? "", getGlobalCredentialStore())
      : undefined;

  // Build request headers (SDK sets MCP-Protocol-Version automatically)
  const headers: Record<string, string> = {
    ...(auth?.type === "bearer" ? { Authorization: `Bearer ${auth.token}` } : {}),
  };

  switch (config.transport) {
    case "stdio":
      if (auth && auth.type !== "none") {
        getLogger().warn(
          "MCP auth is not supported for stdio transport; auth config ignored. " +
            "Use env vars to pass credentials to stdio servers."
        );
      }
      transport = new StdioClientTransport({
        command: config.command!,
        args: config.args,
        env: config.env,
      });
      break;
    case "sse": {
      // SSEClientTransport is deprecated but still needed for legacy servers
      transport = new SSEClientTransport(new URL(config.server_url!), {
        authProvider,
        requestInit: { headers },
      });
      break;
    }
    case "streamable-http": {
      transport = new StreamableHTTPClientTransport(new URL(config.server_url!), {
        authProvider,
        requestInit: { headers },
      });
      break;
    }
    default:
      throw new Error(`Unsupported transport type: ${config.transport}`);
  }

  const client = new Client({ name: "workglow-mcp-client", version: "1.0.0" });

  if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        client.close().catch(() => {});
      },
      { once: true }
    );
  }

  // try {
  await client.connect(transport);
  // } catch (err) {
  //   const message = err instanceof Error ? err.message : String(err);
  //   const url = config.server_url ?? "";
  //   const is405 =
  //     message.includes("405") ||
  //     message.includes("Method Not Allowed") ||
  //     (typeof err === "object" &&
  //       err !== null &&
  //       "status" in err &&
  //       (err as { status: number }).status === 405);
  //   if (is405) {
  //     throw new Error(
  //       `MCP connection failed with 405 Method Not Allowed for ${url}. ` +
  //         `This usually means the server does not accept GET requests. `,
  //       { cause: err }
  //     );
  //   }
  //   const is406 =
  //     message.includes("406") ||
  //     message.includes("Not Acceptable") ||
  //     (typeof err === "object" &&
  //       err !== null &&
  //       "code" in err &&
  //       (err as { code: number }).code === 406);
  //   if (is406) {
  //     throw new Error(
  //       `MCP connection failed with 406 Not Acceptable for ${url}. ` +
  //         `Try using transport "sse" instead of "streamable-http", or ensure the server accepts the request format (Accept: application/json, text/event-stream and MCP-Protocol-Version).`,
  //       { cause: err }
  //     );
  //   }
  //   throw err;
  // }
  return { client, transport };
}

export const mcpClientFactory = {
  create: createMcpClient,
};
