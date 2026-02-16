/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { StripJSONSchema } from "@workglow/util";
import { TaskOutputRepository } from "../storage/TaskOutputRepository";
import type { Task } from "./Task";

/**
 * Enum representing the possible states of a task
 *
 *  PENDING -> PROCESSING -> COMPLETED
 *  PENDING -> PROCESSING -> STREAMING -> COMPLETED
 *  PENDING -> PROCESSING -> ABORTING -> FAILED
 *  PENDING -> PROCESSING -> FAILED
 *  PENDING -> DISABLED
 */
export type TaskStatus =
  | "PENDING"
  | "DISABLED"
  | "PROCESSING"
  | "STREAMING"
  | "COMPLETED"
  | "ABORTING"
  | "FAILED";

export const TaskStatus = {
  /** Task is created but not yet started */
  PENDING: "PENDING",
  /** Task is disabled due to conditional logic */
  DISABLED: "DISABLED",
  /** Task is currently running */
  PROCESSING: "PROCESSING",
  /** Task has begun producing streaming output chunks */
  STREAMING: "STREAMING",
  /** Task has completed successfully */
  COMPLETED: "COMPLETED",
  /** Task is in the process of being aborted */
  ABORTING: "ABORTING",
  /** Task has failed */
  FAILED: "FAILED",
} as const satisfies Record<TaskStatus, TaskStatus>;

// ========================================================================
// Core Task Data Types
// ========================================================================

export interface DataPorts extends StripJSONSchema<Record<string, any>> {
  [key: string]: unknown;
}

/** Type for task input data */
export type TaskInput = DataPorts;

/** Type for task output data */
export type TaskOutput = DataPorts;

export type CompoundTaskOutput =
  | {
      outputs: TaskOutput[];
    }
  | {
      [key: string]: unknown | unknown[] | undefined;
    };

/** Type for task type names */
export type TaskTypeName = string;

/** Type for task configuration */
export type TaskConfig = Partial<IConfig>;

// ========================================================================
// Task Configuration Types
// ========================================================================

export interface IConfig {
  /** Unique identifier for the task */
  id: unknown;

  /** Optional display name for the task */
  name?: string;

  /** Optional ID of the runner to use for this task */
  runnerId?: string;

  /** Optional output cache to use for this task */
  outputCache?: TaskOutputRepository | boolean;

  /** Optional cacheable flag to use for this task, overriding the default static property */
  cacheable?: boolean;

  /** Optional user data to use for this task, not used by the task framework except it will be exported as part of the task JSON*/
  extras?: DataPorts;
}

/** Type for task ID */
export type TaskIdType = Task<TaskInput, TaskOutput, TaskConfig>["config"]["id"];
