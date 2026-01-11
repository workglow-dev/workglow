/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";

const log_levels = ["dir", "log", "debug", "info", "warn", "error"] as const;
type LogLevel = (typeof log_levels)[number];
const DEFAULT_LOG_LEVEL: LogLevel = "log";

const inputSchema = {
  type: "object",
  properties: {
    console: {
      title: "Message",
      description: "The message to log",
    },
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

const outputSchema = {
  type: "object",
  properties: {
    console: {
      title: "Messages",
      description: "The messages logged by the task",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type DebugLogTaskInput = FromSchema<typeof inputSchema>;
export type DebugLogTaskOutput = FromSchema<typeof outputSchema>;

/**
 * DebugLogTask provides console logging functionality as a task within the system.
 *
 * Features:
 * - Supports multiple log levels (info, warn, error, dir)
 * - Passes through the logged message as output
 * - Configurable logging format and depth
 *
 * This task is particularly useful for debugging task graphs and monitoring
 * data flow between tasks during development and testing.
 */
export class DebugLogTask<
  Input extends DebugLogTaskInput = DebugLogTaskInput,
  Output extends DebugLogTaskOutput = DebugLogTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  public static type = "DebugLogTask";
  public static category = "Utility";
  public static title = "Debug Log";
  public static description =
    "Logs messages to the console with configurable log levels for debugging task graphs";
  static readonly cacheable = false;

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  async executeReactive(input: Input, output: Output) {
    const { log_level = DEFAULT_LOG_LEVEL, console: messages } = input;
    if (log_level == "dir") {
      console.dir(messages, { depth: null });
    } else {
      console[log_level](messages);
    }
    output.console = input.console;
    return output;
  }
}

export const debugLog = (input: DebugLogTaskInput, config: TaskConfig = {}) => {
  const task = new DebugLogTask({}, config);
  return task.run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    debugLog: CreateWorkflow<DebugLogTaskInput, DebugLogTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.debugLog = CreateWorkflow(DebugLogTask);
