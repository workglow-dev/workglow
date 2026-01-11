/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskRegistry } from "@workglow/task-graph";
import { FileLoaderTask } from "./task/FileLoaderTask";

// Register browser-specific tasks with the TaskRegistry.
// Centralized registration ensures tasks are available for JSON deserialization
// and prevents tree-shaking issues.
[FileLoaderTask].map(TaskRegistry.registerTask);

export * from "./common";
export * from "./task/FileLoaderTask";
