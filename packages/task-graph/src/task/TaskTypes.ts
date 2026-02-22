/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { type DataPortSchema, type FromSchema, StripJSONSchema } from "@workglow/util";
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

// ========================================================================
// Task Configuration Schema and Types
// ========================================================================

/**
 * Base JSON Schema for task configuration.
 * Exported so subclasses can compose their own schema with:
 *   `...TaskConfigSchema["properties"]`
 *
 * Fields:
 *  - id:           unique task identifier (any type)
 *  - title:        human-readable name for the task instance (overrides static title)
 *  - description:  human-readable description (overrides static description)
 *  - cacheable:    design-time cache flag (runtime override goes in IRunConfig)
 *  - inputSchema:  dynamic input schema override (for tasks like InputTask)
 *  - outputSchema: dynamic output schema override (for tasks like OutputTask)
 *  - extras:       arbitrary user data serialized with the task JSON
 */
export const TaskConfigSchema = {
  type: "object",
  properties: {
    id: {},
    title: { type: "string" },
    description: { type: "string" },
    cacheable: { type: "boolean" },
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
    outputSchema: { type: "object", properties: {}, additionalProperties: true },
    extras: { type: "object", additionalProperties: true },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

type BaseFromSchema = FromSchema<typeof TaskConfigSchema>;

/**
 * Base type for task configuration, derived from TaskConfigSchema.
 * Use `TaskConfigSchema` when building JSON schemas in subclasses.
 * Use this type when declaring the Config generic parameter.
 */
export type TaskConfig = Omit<BaseFromSchema, "id" | "inputSchema" | "outputSchema"> & {
  /** Unique identifier for the task (uuid4 by default) */
  id?: unknown;
  /** Dynamic input schema override for the task instance */
  inputSchema?: DataPortSchema;
  /** Dynamic output schema override for the task instance */
  outputSchema?: DataPortSchema;
};

/** Type for task ID */
export type TaskIdType = Task<TaskInput, TaskOutput, TaskConfig>["config"]["id"];
