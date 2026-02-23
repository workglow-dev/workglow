/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, Task, TaskConfig, TaskConfigSchema, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";

const log_levels = ["dir", "log", "debug", "info", "warn", "error"] as const;
type LogLevel = (typeof log_levels)[number];
const DEFAULT_LOG_LEVEL: LogLevel = "log";

const debugLogTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    log_level: {
      type: "string",
      enum: log_levels,
      title: "Log Level",
      description: "The log level to use",
      default: DEFAULT_LOG_LEVEL,
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type DebugLogTaskConfig = TaskConfig & {
  /** Log level to use for output */
  log_level?: LogLevel;
};

const inputSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as const satisfies DataPortSchema;

export type DebugLogTaskInput = FromSchema<typeof inputSchema>;
export type DebugLogTaskOutput = FromSchema<typeof outputSchema>;

/**
 * DebugLogTask provides console logging functionality as a task within the system.
 *
 * Features:
 * - Supports multiple log levels (info, warn, error, dir) via config
 * - Passes through all inputs as outputs unchanged
 * - Configurable logging format and depth
 *
 * This task is particularly useful for debugging task graphs and monitoring
 * data flow between tasks during development and testing.
 */
export class DebugLogTask<
  Input extends DebugLogTaskInput = DebugLogTaskInput,
  Output extends DebugLogTaskOutput = DebugLogTaskOutput,
> extends Task<Input, Output, DebugLogTaskConfig> {
  public static type = "DebugLogTask";
  public static category = "Utility";
  public static title = "Debug Log";
  public static description =
    "Logs messages to the console with configurable log levels for debugging task graphs";
  static readonly cacheable = false;
  public static passthroughInputsToOutputs = true;

  public static configSchema(): DataPortSchema {
    return debugLogTaskConfigSchema;
  }

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  async executeReactive(input: Input, output: Output) {
    const log_level: LogLevel = this.config.log_level ?? DEFAULT_LOG_LEVEL;
    const inputRecord = input as Record<string, unknown>;
    if (log_level === "dir") {
      console.dir(inputRecord, { depth: null });
    } else {
      console[log_level](inputRecord);
    }
    Object.assign(output, inputRecord);
    return output;
  }
}

export const debugLog = (input: DebugLogTaskInput, config: DebugLogTaskConfig = {}) => {
  const task = new DebugLogTask({}, config);
  return task.run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    debugLog: CreateWorkflow<DebugLogTaskInput, DebugLogTaskOutput, DebugLogTaskConfig>;
  }
}

Workflow.prototype.debugLog = CreateWorkflow(DebugLogTask);
