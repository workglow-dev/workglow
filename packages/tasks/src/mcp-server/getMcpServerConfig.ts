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
 * Extracts a McpServerConfig from a task's config or input object.
 *
 * If `configOrInput.server` is an object (resolved from registry or inline),
 * it is used as the base. Inline transport/server_url/command/etc properties
 * on configOrInput override the server object's values.
 */
export function getMcpServerConfig(
  configOrInput: Readonly<Record<string, unknown>>
): McpServerConfig {
  let base: Record<string, unknown> = {};

  const server = configOrInput.server;
  if (server && typeof server === "object" && !Array.isArray(server)) {
    base = { ...(server as Record<string, unknown>) };
  }

  for (const key of SERVER_CONFIG_KEYS) {
    const value = configOrInput[key];
    if (value !== undefined) {
      base[key] = value;
    }
  }

  const transport = base.transport as string | undefined;

  if (!transport) {
    throw new Error(
      "MCP server config must include a transport (from server reference or inline config)"
    );
  }

  if (transport === "stdio" && !base.command) {
    throw new Error(
      "MCP server config for stdio transport must include a 'command' (from server reference or inline config)"
    );
  }

  if ((transport === "sse" || transport === "streamable-http") && !base.server_url) {
    throw new Error(
      "MCP server config for sse/streamable-http transport must include a 'server_url' (from server reference or inline config)"
    );
  }

  return base as unknown as McpServerConfig;
}
