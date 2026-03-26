/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelRepository, ModelPrimaryKeyNames, ModelRecordSchema } from "@workglow/ai";
import { FsFolderTabularStorage } from "@workglow/storage";
import {
  TaskGraphTabularRepository,
  TaskGraphSchema,
  TaskGraphPrimaryKeyNames,
} from "@workglow/task-graph";
import { mcpAuthConfigSchema } from "@workglow/tasks";
import type { CliConfig } from "./config";

export const McpServerRecordSchema = {
  type: "object",
  properties: {
    name: { type: "string", "x-auto-generated": false },
    transport: { type: "string", enum: ["stdio", "sse", "streamable-http"] },
    server_url: { type: "string" },
    command: { type: "string" },
    args: { type: "array", items: { type: "string" } },
    env: { type: "object", additionalProperties: { type: "string" } },
    ...mcpAuthConfigSchema.properties,
  },
  required: ["name", "transport", "auth_type"],
} as const;

export const McpServerPrimaryKeyNames = ["name"] as const;

export function createModelRepository(config: CliConfig): ModelRepository {
  const storage = new FsFolderTabularStorage(
    config.directories.models,
    ModelRecordSchema,
    ModelPrimaryKeyNames
  );
  return new ModelRepository(storage);
}

export function createWorkflowRepository(config: CliConfig): TaskGraphTabularRepository {
  return new TaskGraphTabularRepository({
    tabularRepository: new FsFolderTabularStorage(
      config.directories.workflows,
      TaskGraphSchema,
      TaskGraphPrimaryKeyNames
    ),
  });
}

export function createAgentRepository(config: CliConfig): TaskGraphTabularRepository {
  return new TaskGraphTabularRepository({
    tabularRepository: new FsFolderTabularStorage(
      config.directories.agents,
      TaskGraphSchema,
      TaskGraphPrimaryKeyNames
    ),
  });
}

export function createMcpStorage(
  config: CliConfig
): FsFolderTabularStorage<typeof McpServerRecordSchema, typeof McpServerPrimaryKeyNames> {
  return new FsFolderTabularStorage(
    config.directories.mcps,
    McpServerRecordSchema,
    McpServerPrimaryKeyNames
  );
}
