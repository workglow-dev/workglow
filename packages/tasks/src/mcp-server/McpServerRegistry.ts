/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createServiceToken,
  globalServiceRegistry,
  registerInputResolver,
  ServiceRegistry,
} from "@workglow/util";
import { InMemoryMcpServerRepository } from "./InMemoryMcpServerRepository";
import { McpServerRepository } from "./McpServerRepository";
import type { McpServerTaskConfig } from "./McpServerSchema";

/**
 * Service token for the global MCP server repository
 */
export const MCP_SERVER_REPOSITORY =
  createServiceToken<McpServerRepository>("mcp-server.repository");

// Register default factory if not already registered
if (!globalServiceRegistry.has(MCP_SERVER_REPOSITORY)) {
  globalServiceRegistry.register(
    MCP_SERVER_REPOSITORY,
    (): McpServerRepository => new InMemoryMcpServerRepository(),
    true
  );
}

/**
 * Gets the global MCP server repository instance
 */
export function getGlobalMcpServerRepository(): McpServerRepository {
  return globalServiceRegistry.get(MCP_SERVER_REPOSITORY);
}

/**
 * Sets the global MCP server repository instance
 */
export function setGlobalMcpServerRepository(repository: McpServerRepository): void {
  globalServiceRegistry.registerInstance(MCP_SERVER_REPOSITORY, repository);
}

/**
 * Resolves an MCP server ID to a McpServerTaskConfig from the repository.
 * Used by the input resolver system.
 */
async function resolveMcpServerFromRegistry(
  id: string,
  format: string,
  registry: ServiceRegistry
): Promise<McpServerTaskConfig | undefined> {
  const serverRepo = registry.has(MCP_SERVER_REPOSITORY)
    ? registry.get<McpServerRepository>(MCP_SERVER_REPOSITORY)
    : getGlobalMcpServerRepository();

  const server = await serverRepo.findByName(id);
  if (!server) {
    throw new Error(`MCP server "${id}" not found in repository`);
  }
  return server;
}

// Register the MCP server resolver for format: "mcp-server"
registerInputResolver("mcp-server", resolveMcpServerFromRegistry);
