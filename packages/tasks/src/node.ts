/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "./task/image/registerImageRasterCodec.node";
import "./task/image/registerImageTextRenderer.node";
// Install the DNS-resolving, connection-pinning SafeFetch implementation.
// This side-effect import must happen before FetchUrlTask is used.
import "./util/SafeFetch.server";

export * from "./common";
export * from "./task/FileLoaderTask.server";
export * from "./util/McpAuthProvider";
export * from "./util/McpAuthTypes";
export * from "./util/McpClientUtil";
export * from "./util/McpTaskDeps";

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mcpClientFactory, mcpServerConfigSchema } from "./util/McpClientUtil";
import type { McpServerConfig } from "./util/McpTaskDeps";
import { registerMcpTaskDeps } from "./util/McpTaskDeps";

registerMcpTaskDeps({
  mcpClientFactory,
  mcpServerConfigSchema,
  createStdioTransport: (config: McpServerConfig) =>
    Promise.resolve(
      new StdioClientTransport({
        command: config.command!,
        args: config.args,
        env: config.env,
      })
    ),
});

import { TaskRegistry } from "@workglow/task-graph";
import { registerCommonTasks as registerCommonTasksFn } from "./common";
import { FileLoaderTask } from "./task/FileLoaderTask.server";

export const registerCommonTasks = () => {
  const tasks = registerCommonTasksFn();
  TaskRegistry.registerTask(FileLoaderTask);
  return [...tasks, FileLoaderTask];
};
