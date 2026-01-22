/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export * from "./BatchTask";
export * from "./ConditionalTask";
export * from "./ForEachTask";
export * from "./GraphAsTask";
export * from "./GraphAsTaskRunner";
export * from "./InputResolver";
export * from "./ITask";
export * from "./IteratorTask";
export * from "./IteratorTaskRunner";
export * from "./JobQueueFactory";
export * from "./JobQueueTask";
export * from "./MapTask";
export * from "./ReduceTask";
export * from "./Task";
export * from "./TaskError";
export * from "./TaskEvents";
export * from "./TaskJSON";
export * from "./TaskQueueRegistry";
export * from "./TaskRegistry";
export * from "./TaskTypes";
export * from "./WhileTask";

import { BatchTask } from "./BatchTask";
import { ConditionalTask } from "./ConditionalTask";
import { ForEachTask } from "./ForEachTask";
import { GraphAsTask } from "./GraphAsTask";
import { MapTask } from "./MapTask";
import { ReduceTask } from "./ReduceTask";
import { TaskRegistry } from "./TaskRegistry";
import { WhileTask } from "./WhileTask";

export const registerBaseTasks = () => {
  const tasks = [
    ConditionalTask,
    GraphAsTask,
    ForEachTask,
    MapTask,
    BatchTask,
    WhileTask,
    ReduceTask,
  ];
  tasks.map(TaskRegistry.registerTask);
  return tasks;
};
