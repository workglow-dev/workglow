/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecutePreviewContext,
  Task,
  TaskConfig,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";

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
      enum: ["iso", "date", "time", "datetime", "unix"],
      description: "Output format: 'iso', 'date', 'time', 'datetime', 'unix'",
      default: "iso",
    },
    locale: {
      type: "string",
      title: "Locale",
      description: "Locale string (e.g. 'en-US')",
      default: "en-US",
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
  static override readonly type = "DateFormatTask";
  static override readonly category = "Utility";
  public static override title = "Date Format";
  public static override description = "Parses and formats a date string";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    const dateInput = /^\d+$/.test(input.value) ? Number(input.value) : input.value;
    const date = new Date(dateInput);

    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${input.value}`);
    }

    const format = input.format ?? "iso";
    const locale = input.locale;
    const timeZone = input.timeZone;
    let result: string;

    switch (format) {
      case "iso":
        result = date.toISOString();
        break;
      case "date":
        result = date.toLocaleDateString(locale, timeZone ? { timeZone } : undefined);
        break;
      case "time":
        result = date.toLocaleTimeString(locale, timeZone ? { timeZone } : undefined);
        break;
      case "unix":
        result = String(date.getTime());
        break;
      case "datetime":
      default:
        result = date.toLocaleString(locale, timeZone ? { timeZone } : undefined);
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
