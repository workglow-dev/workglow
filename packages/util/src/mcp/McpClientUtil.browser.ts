/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Browser-only MCP client util. Supports streamable-http only.
 * stdio and sse are not available in the browser.
 */

import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { DataPortSchemaObject } from "../json-schema/DataPortSchema.js";

export const mcpTransportTypes = ["streamable-http"] as const;

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
    description: "The URL of the MCP server (for streamable-http transport)",
  },
} as const satisfies DataPortSchemaObject["properties"];

export type McpTransportType = (typeof mcpTransportTypes)[number];

export interface McpServerConfig {
  transport: McpTransportType;
  server_url?: string;
}

export async function createMcpClient(
  config: McpServerConfig,
  signal?: AbortSignal
): Promise<{ client: Client; transport: Transport }> {
  if (config.transport !== "streamable-http") {
    throw new Error(
      `Unsupported transport type in browser: ${config.transport}. Only streamable-http is available.`
    );
  }

  const transport = new StreamableHTTPClientTransport(new URL(config.server_url!));

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
