/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export * from "./ConditionalTask";
export * from "./GraphAsTask";
export * from "./GraphAsTaskRunner";
export * from "./InputResolver";
export * from "./ITask";
export * from "./JobQueueFactory";
export * from "./JobQueueTask";
export * from "./Task";
export * from "./TaskError";
export * from "./TaskEvents";
export * from "./TaskJSON";
export * from "./TaskQueueRegistry";
export * from "./TaskRegistry";
export * from "./TaskTypes";

import { ConditionalTask } from "./ConditionalTask";
import { GraphAsTask } from "./GraphAsTask";
import { TaskRegistry } from "./TaskRegistry";

export const registerBaseTasks = () => {
  const tasks = [ConditionalTask, GraphAsTask];
  tasks.map(TaskRegistry.registerTask);
  return tasks;
};
