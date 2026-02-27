/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskRegistry } from "@workglow/task-graph";
import { registerCommonTasks as registerCommonTasksFn } from "./common";
import { FileLoaderTask } from "./task/FileLoaderTask";

export * from "./common";
export * from "./task/FileLoaderTask";

export const registerCommonTasks = () => {
  const tasks = registerCommonTasksFn();
  TaskRegistry.registerTask(FileLoaderTask);
  return [...tasks, FileLoaderTask];
};
