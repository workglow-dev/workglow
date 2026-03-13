/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import { McpServerRepository } from "./McpServerRepository";
import { McpServerPrimaryKeyNames, McpServerRecordSchema } from "./McpServerSchema";

/**
 * In-memory implementation of an MCP server repository.
 * Provides storage and retrieval for MCP server configurations.
 */
export class InMemoryMcpServerRepository extends McpServerRepository {
  constructor() {
    super(new InMemoryTabularStorage(McpServerRecordSchema, McpServerPrimaryKeyNames));
  }
}
