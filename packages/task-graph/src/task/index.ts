/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export * from "./ConditionalTask";
export * from "./ConditionUtils";
export * from "./GraphAsTask";
export * from "./GraphAsTaskRunner";
export * from "./InputResolver";
export * from "./ITask";
export * from "./iterationSchema";
export * from "./IteratorTask";
export * from "./IteratorTaskRunner";
export * from "./JobQueueFactory";
export * from "./JobQueueTask";
export * from "./MapTask";
export * from "./ReduceTask";
export * from "./StreamTypes";
export * from "./Task";
export * from "./TaskError";
export * from "./TaskEvents";
export * from "./TaskJSON";
export * from "./TaskQueueRegistry";
export * from "./TaskRegistry";
export * from "./TaskTypes";
export * from "./WhileTask";
export * from "./WhileTaskRunner";

import { ConditionalTask } from "./ConditionalTask";
import { GraphAsTask } from "./GraphAsTask";
import { MapTask } from "./MapTask";
import { ReduceTask } from "./ReduceTask";
import { TaskRegistry } from "./TaskRegistry";
import { WhileTask } from "./WhileTask";

export const registerBaseTasks = () => {
  const tasks = [GraphAsTask, ConditionalTask, MapTask, WhileTask, ReduceTask];
  tasks.map(TaskRegistry.registerTask);
  return tasks;
};
