/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventParameters, type DataPortSchema } from "@workglow/util";
import type { StreamEvent } from "./StreamTypes";
import { TaskAbortedError, TaskError } from "./TaskError";
import { TaskStatus } from "./TaskTypes";

// ========================================================================
// Event Handling Types
// ========================================================================
/**
 * Event listeners for task lifecycle events
 */

export type TaskEventListeners = {
  /** Fired when a task starts execution */
  start: () => void;

  /** Fired when a task completes successfully */
  complete: () => void;

  /** Fired when a task is aborted */
  abort: (error: TaskAbortedError) => void;

  /** Fired when a task encounters an error */
  error: (error: TaskError) => void;

  /** Fired when a task is disabled */
  disabled: () => void;

  /** Fired when a task reports progress */
  progress: (progress: number, message?: string, ...args: any[]) => void;

  /** Fired when a regenerative task regenerates its graph */
  regenerate: () => void;

  /** Fired when a task is reset to original state */
  reset: () => void;

  /** Fired when a task status is updated */
  status: (status: TaskStatus) => void;

  /** Fired when a task's input or output schema changes (for tasks with dynamic schemas) */
  schemaChange: (inputSchema?: DataPortSchema, outputSchema?: DataPortSchema) => void;

  /** Fired when a streaming task begins producing chunks */
  stream_start: () => void;

  /** Fired for each stream chunk produced by a streaming task */
  stream_chunk: (event: StreamEvent) => void;

  /** Fired when a streaming task finishes (carries final output) */
  stream_end: (output: Record<string, any>) => void;
};
/** Union type of all possible task event names */

export type TaskEvents = keyof TaskEventListeners;
/** Type for task event listener functions */

export type TaskEventListener<Event extends TaskEvents> = TaskEventListeners[Event];
/** Type for task event parameters */

export type TaskEventParameters<Event extends TaskEvents> = EventParameters<
  TaskEventListeners,
  Event
>;
