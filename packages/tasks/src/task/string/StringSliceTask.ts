/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecuteReactiveContext,
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
      description: "Input string",
    },
    start: {
      type: "integer",
      title: "Start",
      description: "Start index (inclusive, supports negative indexing)",
    },
    end: {
      type: "integer",
      title: "End",
      description: "End index (exclusive, supports negative indexing)",
    },
  },
  required: ["value", "start"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: {
      type: "string",
      title: "Result",
      description: "Extracted substring",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringSliceTaskInput = FromSchema<typeof inputSchema>;
export type StringSliceTaskOutput = FromSchema<typeof outputSchema>;

export class StringSliceTask<
  Input extends StringSliceTaskInput = StringSliceTaskInput,
  Output extends StringSliceTaskOutput = StringSliceTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "StringSliceTask";
  static readonly category = "String";
  public static title = "Slice";
  public static description = "Extracts a substring by start and optional end index";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async executeReactive(
    input: Input,
    output: Output,
    _context: IExecuteReactiveContext
  ): Promise<Output> {
    return { result: input.value.slice(input.start, input.end) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringSlice: CreateWorkflow<StringSliceTaskInput, StringSliceTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.stringSlice = CreateWorkflow(StringSliceTask);
