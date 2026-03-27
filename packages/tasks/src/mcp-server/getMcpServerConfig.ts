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
 */
export function getMcpServerConfig(
  configOrInput: Readonly<Record<string, unknown>>,
  resolvedConfig: Readonly<Record<string, unknown>> | undefined
): McpServerConfig {
  let base: Record<string, unknown> = {};

  const resolvedServer = resolvedConfig?.server;
  if (resolvedServer && typeof resolvedServer === "object" && !Array.isArray(resolvedServer)) {
    base = { ...(resolvedServer as Record<string, unknown>) };
  }

  const inlineServer = configOrInput.server;
  if (
    Object.keys(base).length === 0 &&
    inlineServer &&
    typeof inlineServer === "object" &&
    !Array.isArray(inlineServer)
  ) {
    base = { ...(inlineServer as Record<string, unknown>) };
  }

  for (const key of SERVER_CONFIG_KEYS) {
    const value = configOrInput[key];
    if (value !== undefined) {
      base[key] = value;
    }
  }

  if (!base.transport) {
    throw new Error("MCP server config must include a transport");
  }

  return base as unknown as McpServerConfig;
}
