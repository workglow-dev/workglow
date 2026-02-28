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
import { DataPortSchema, FromSchema } from "@workglow/util";

const inputSchema = {
  type: "object",
  properties: {
    value: {
      type: "string",
      title: "Value",
      description: "Input string",
    },
  },
  required: ["value"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: {
      type: "integer",
      title: "Result",
      description: "Length of the string",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringLengthTaskInput = FromSchema<typeof inputSchema>;
export type StringLengthTaskOutput = FromSchema<typeof outputSchema>;

export class StringLengthTask<
  Input extends StringLengthTaskInput = StringLengthTaskInput,
  Output extends StringLengthTaskOutput = StringLengthTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "StringLengthTask";
  static readonly category = "String";
  public static title = "Length";
  public static description = "Returns the length of a string";

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
    return { result: input.value.length } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringLength: CreateWorkflow<StringLengthTaskInput, StringLengthTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.stringLength = CreateWorkflow(StringLengthTask);
