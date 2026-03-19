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
import {
  McpServerRepository,
  McpServerRecordSchema,
  McpServerPrimaryKeyNames,
} from "@workglow/tasks";
import type { CliConfig } from "./config";

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

export function createMcpServerRepository(config: CliConfig): McpServerRepository {
  return new McpServerRepository(
    new FsFolderTabularStorage(
      config.directories.mcps,
      McpServerRecordSchema,
      McpServerPrimaryKeyNames
    )
  );
}
