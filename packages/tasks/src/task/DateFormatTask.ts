/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";

const inputSchema = {
  type: "object",
  properties: {
    value: {
      type: "string",
      title: "Value",
      description: "Date string, ISO 8601 timestamp, or Unix timestamp in milliseconds",
    },
    format: {
      type: "string",
      title: "Format",
      description:
        "Output format: 'iso', 'date', 'time', 'datetime', 'unix', or a locale string (e.g. 'en-US')",
      default: "iso",
    },
    timeZone: {
      type: "string",
      title: "Time Zone",
      description: "IANA time zone (e.g. 'America/New_York', 'UTC')",
    },
  },
  required: ["value"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: {
      type: "string",
      title: "Result",
      description: "Formatted date string",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type DateFormatTaskInput = FromSchema<typeof inputSchema>;
export type DateFormatTaskOutput = FromSchema<typeof outputSchema>;

export class DateFormatTask<
  Input extends DateFormatTaskInput = DateFormatTaskInput,
  Output extends DateFormatTaskOutput = DateFormatTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "DateFormatTask";
  static readonly category = "Utility";
  public static title = "Date Format";
  public static description = "Parses and formats a date string";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async execute(input: Input, _context: IExecuteContext): Promise<Output> {
    const dateInput = /^\d+$/.test(input.value) ? Number(input.value) : input.value;
    const date = new Date(dateInput);

    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${input.value}`);
    }

    const format = input.format ?? "iso";
    const timeZone = input.timeZone;
    let result: string;

    switch (format) {
      case "iso":
        result = date.toISOString();
        break;
      case "date":
        result = date.toLocaleDateString("en-US", timeZone ? { timeZone } : undefined);
        break;
      case "time":
        result = date.toLocaleTimeString("en-US", timeZone ? { timeZone } : undefined);
        break;
      case "datetime":
        result = date.toLocaleString("en-US", timeZone ? { timeZone } : undefined);
        break;
      case "unix":
        result = String(date.getTime());
        break;
      default:
        // Treat format as a locale identifier
        result = date.toLocaleString(format, timeZone ? { timeZone } : undefined);
        break;
    }

    return { result } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    dateFormat: CreateWorkflow<DateFormatTaskInput, DateFormatTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.dateFormat = CreateWorkflow(DateFormatTask);
