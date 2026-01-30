/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export * from "./task/ArrayTask";
export * from "./task/DebugLogTask";
export * from "./task/DelayTask";
export * from "./task/FetchUrlTask";
export * from "./task/InputTask";
export * from "./task/JavaScriptTask";
export * from "./task/JsonTask";
export * from "./task/LambdaTask";
export * from "./task/MergeTask";
export * from "./task/OutputTask";
export * from "./task/SplitTask";

import { TaskRegistry } from "@workglow/task-graph";
import { DebugLogTask } from "./task/DebugLogTask";
import { DelayTask } from "./task/DelayTask";
import { FetchUrlTask } from "./task/FetchUrlTask";
import { InputTask } from "./task/InputTask";
import { JavaScriptTask } from "./task/JavaScriptTask";
import { JsonTask } from "./task/JsonTask";
import { LambdaTask } from "./task/LambdaTask";
import { MergeTask } from "./task/MergeTask";
import { OutputTask } from "./task/OutputTask";
import { SplitTask } from "./task/SplitTask";

// Register all common tasks with the TaskRegistry.
// Centralized registration ensures tasks are available for JSON deserialization
// and prevents tree-shaking issues.
export const registerCommonTasks = () => {
  const tasks = [
    DebugLogTask,
    DelayTask,
    FetchUrlTask,
    InputTask,
    JavaScriptTask,
    JsonTask,
    LambdaTask,
    MergeTask,
    OutputTask,
    SplitTask,
  ];
  tasks.map(TaskRegistry.registerTask);
  return tasks;
};
