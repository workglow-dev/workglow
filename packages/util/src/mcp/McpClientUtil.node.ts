/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Node/Bun MCP client util. Supports stdio, sse, and streamable-http.
 * stdio and sse are not available in the browser.
 */

import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// eslint-disable-next-line deprecation/deprecation
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { DataPortSchemaObject } from "../json-schema/DataPortSchema.js";

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
    format: "uri",
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
} as const satisfies DataPortSchemaObject["properties"];

export type McpTransportType = (typeof mcpTransportTypes)[number];

export interface McpServerConfig {
  transport: McpTransportType;
  server_url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export async function createMcpClient(
  config: McpServerConfig,
  signal?: AbortSignal
): Promise<{ client: Client; transport: Transport }> {
  let transport: Transport;

  switch (config.transport) {
    case "stdio":
      transport = new StdioClientTransport({
        command: config.command!,
        args: config.args,
        env: config.env,
      });
      break;
    case "sse":
      // SSEClientTransport is deprecated but still needed for legacy servers
      transport = new SSEClientTransport(new URL(config.server_url!));
      break;
    case "streamable-http":
      transport = new StreamableHTTPClientTransport(new URL(config.server_url!));
      break;
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

  await client.connect(transport);
  return { client, transport };
}

export const mcpClientFactory = {
  create: createMcpClient,
};
