/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskRegistry } from "@workglow/task-graph";
import { BrowserCloseTask } from "./task/browser/BrowserCloseTask";
import { BrowserClickTask } from "./task/browser/BrowserClickTask";
import { BrowserEvaluateTask } from "./task/browser/BrowserEvaluateTask";
import { BrowserExtractTask } from "./task/browser/BrowserExtractTask";
import { BrowserNavigateTask } from "./task/browser/BrowserNavigateTask";
import { BrowserTransformTask } from "./task/browser/BrowserTransformTask";
import { BrowserWaitTask } from "./task/browser/BrowserWaitTask";
import { FileLoaderTask } from "./task/FileLoaderTask.server";

// Register server-specific tasks with the TaskRegistry.
// Centralized registration ensures tasks are available for JSON deserialization
// and prevents tree-shaking issues.
[
  FileLoaderTask,
  BrowserNavigateTask,
  BrowserExtractTask,
  BrowserClickTask,
  BrowserWaitTask,
  BrowserEvaluateTask,
  BrowserTransformTask,
  BrowserCloseTask,
].map(TaskRegistry.registerTask);

export * from "./common";
export * from "./task/browser";
export * from "./task/FileLoaderTask.server";
