/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "./task/image/registerImageRasterCodec.node";
// Install the DNS-resolving, connection-pinning SafeFetch implementation.
// This side-effect import must happen before FetchUrlTask is used.
import "./util/SafeFetch.server";

export * from "./common";
export * from "./task/browser-control/PlaywrightBackend";
export * from "./task/FileLoaderTask.server";
export * from "./util/McpAuthProvider";
export * from "./util/McpAuthTypes";
export * from "./util/McpClientUtil";
export * from "./util/McpTaskDeps";

import { TaskRegistry } from "@workglow/task-graph";
import { registerCommonTasks as registerCommonTasksFn } from "./common";
import { registerBrowserDepsServer, registerMcpTaskDepsServer } from "./server";
import { FileLoaderTask } from "./task/FileLoaderTask.server";

registerMcpTaskDepsServer();
registerBrowserDepsServer();

export const registerCommonTasks = () => {
  const tasks = registerCommonTasksFn();
  TaskRegistry.registerTask(FileLoaderTask);
  return [...tasks, FileLoaderTask];
};
