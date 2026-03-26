/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { JobError } from "@workglow/job-queue";
import { BaseError } from "@workglow/util";

export class TaskError extends BaseError {
  static readonly type: string = "TaskError";
  /** The type of the task that produced this error, if available. */
  public taskType?: string;
  /** The ID of the task that produced this error, if available. */
  public taskId?: unknown;
  constructor(message: string) {
    super(message);
  }
}

/**
 * A task configuration error
 *
 */
export class TaskConfigurationError extends TaskError {
  static readonly type: string = "TaskConfigurationError";
  constructor(message: string) {
    super(message);
  }
}

/**
 * A task workflow error
 */
export class WorkflowError extends TaskError {
  static readonly type: string = "WorkflowError";
  constructor(message: string) {
    super(message);
  }
}

/**
 * A task error that is caused by a task being aborted
 *
 * Examples: task.abort() was called, or some other reason an abort signal was received
 */
export class TaskAbortedError extends TaskError {
  static readonly type: string = "TaskAbortedError";
  constructor(message: string = "Task aborted") {
    super(message);
  }
}

/**
 * A task error that is caused by a task exceeding its timeout
 *
 * Examples: task.runConfig.timeout exceeded during execution
 */
export class TaskTimeoutError extends TaskAbortedError {
  static readonly type: string = "TaskTimeoutError";
  constructor(timeoutMs?: number) {
    super(timeoutMs ? `Task timed out after ${timeoutMs}ms` : "Task timed out");
  }
}

/**
 * A task error that is caused by a task failing
 *
 * Examples: task.run() threw an error
 */
export class TaskFailedError extends TaskError {
  static readonly type: string = "TaskFailedError";
  constructor(message: string = "Task failed") {
    super(message);
  }
}

export class JobTaskFailedError extends TaskFailedError {
  static readonly type: string = "JobTaskFailedError";
  public jobError: JobError;
  constructor(err: JobError) {
    super(String(err));
    this.jobError = err;
  }
}

/**
 * A task error that is caused by an error converting JSON to a Task
 */
export class TaskJSONError extends TaskError {
  static readonly type: string = "TaskJSONError";
  constructor(message: string = "Error converting JSON to a Task") {
    super(message);
  }
}

/**
 * A task error that is caused by invalid input data
 *
 * Examples: task.run() received invalid input data
 */
export class TaskInvalidInputError extends TaskError {
  static readonly type: string = "TaskInvalidInputError";
  constructor(message: string = "Invalid input data") {
    super(message);
  }
}
