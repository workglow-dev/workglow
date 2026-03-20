/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Platform MCP client + JSON Schema for MCP tasks. Registered from browser/node/bun
 * entry files so task implementations do not import `@workglow/tasks` (self-import).
 */

import type { Client } from "@modelcontextprotocol/sdk/client";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { DataPortSchemaObject } from "@workglow/util";
import { createServiceToken, globalServiceRegistry } from "@workglow/util";

/** Config passed to `mcpClientFactory.create` (transport union differs by platform build). */
export type McpConnectionConfig = Record<string, unknown>;

export interface McpTaskDeps {
  readonly mcpClientFactory: {
    readonly create: (
      config: McpConnectionConfig,
      signal?: AbortSignal
    ) => Promise<{ client: Client; transport: Transport }>;
  };
  readonly mcpServerConfigSchema: {
    readonly properties: DataPortSchemaObject["properties"];
    readonly allOf: NonNullable<DataPortSchemaObject["allOf"]>;
  };
}

export const MCP_TASK_DEPS = createServiceToken<McpTaskDeps>("@workglow/tasks/mcp");

export function registerMcpTaskDeps(deps: McpTaskDeps): void {
  globalServiceRegistry.registerInstance(MCP_TASK_DEPS, deps);
}

export function getMcpTaskDeps(): McpTaskDeps {
  if (!globalServiceRegistry.has(MCP_TASK_DEPS)) {
    throw new Error(
      "MCP task dependencies not registered. Import @workglow/tasks from a platform entry (browser, node, or bun) before using MCP tasks."
    );
  }
  return globalServiceRegistry.get(MCP_TASK_DEPS);
}
