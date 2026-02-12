/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskGraphJson } from "../task/TaskJSON";
import type { TaskInput, TaskOutput, TaskStatus } from "../task/TaskTypes";

export type CheckpointId = string;
export type ThreadId = string;

export type CheckpointGranularity = "every-task" | "top-level-only" | "none";

export interface TaskCheckpointState {
  taskId: unknown;
  taskType: string;
  status: TaskStatus;
  inputData: TaskInput;
  outputData: TaskOutput;
  progress: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface DataflowCheckpointState {
  id: string;
  sourceTaskId: unknown;
  targetTaskId: unknown;
  status: TaskStatus;
  portData?: TaskOutput;
}

export interface CheckpointData {
  checkpointId: CheckpointId;
  threadId: ThreadId;
  parentCheckpointId?: CheckpointId;
  graphJson: TaskGraphJson;
  taskStates: TaskCheckpointState[];
  dataflowStates: DataflowCheckpointState[];
  metadata: {
    createdAt: string;
    triggerTaskId?: unknown;
    iterationIndex?: number;
    iterationParentTaskId?: unknown;
  };
}
