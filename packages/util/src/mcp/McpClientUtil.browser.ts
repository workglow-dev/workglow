/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Browser-only MCP client util. Supports streamable-http only.
 * stdio is not available in the browser.
 */

import { Client } from "@modelcontextprotocol/sdk/client";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { DataPortSchemaObject } from "../json-schema/DataPortSchema.js";

export const mcpTransportTypes = ["streamable-http", "sse"] as const;

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
  let transport: Transport;

  switch (config.transport) {
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

  try {
    await client.connect(transport);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const url = config.server_url ?? "";
    const is405 =
      message.includes("405") ||
      message.includes("Method Not Allowed") ||
      (typeof err === "object" &&
        err !== null &&
        "status" in err &&
        (err as { status: number }).status === 405);
    if (is405) {
      throw new Error(
        `MCP connection failed with 405 Method Not Allowed for ${url}. ` +
          `This usually means the server does not accept GET requests. `,
        { cause: err }
      );
    }
    throw err;
  }
  return { client, transport };
}

export const mcpClientFactory = {
  create: createMcpClient,
};
