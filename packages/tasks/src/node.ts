/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export * from "./common";
export * from "./util/McpAuthTypes";
export * from "./util/McpAuthProvider";
export * from "./util/McpClientUtil.node";
export * from "./util/McpTaskDeps";
export * from "./task/FileLoaderTask.server";

import { mcpClientFactory, mcpServerConfigSchema } from "./util/McpClientUtil.node";
import { registerMcpTaskDeps } from "./util/McpTaskDeps";

registerMcpTaskDeps({ mcpClientFactory, mcpServerConfigSchema });

import { TaskRegistry } from "@workglow/task-graph";
import { registerCommonTasks as registerCommonTasksFn } from "./common";
import { FileLoaderTask } from "./task/FileLoaderTask.server";

export const registerCommonTasks = () => {
  const tasks = registerCommonTasksFn();
  TaskRegistry.registerTask(FileLoaderTask);
  return [...tasks, FileLoaderTask];
};
