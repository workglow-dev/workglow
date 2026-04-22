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
    text: {
      type: "string",
      title: "Text",
      description: "Input string",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    length: {
      type: "integer",
      title: "Length",
      description: "Length of the string",
    },
  },
  required: ["length"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringLengthTaskInput = FromSchema<typeof inputSchema>;
export type StringLengthTaskOutput = FromSchema<typeof outputSchema>;

export class StringLengthTask<
  Input extends StringLengthTaskInput = StringLengthTaskInput,
  Output extends StringLengthTaskOutput = StringLengthTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "StringLengthTask";
  static override readonly category = "String";
  public static override title = "Length";
  public static override description = "Returns the length of a string";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async executeReactive(
    input: Input,
    _output: Output,
    _context: IExecuteReactiveContext
  ): Promise<Output> {
    return { length: input.text.length } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringLength: CreateWorkflow<StringLengthTaskInput, StringLengthTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.stringLength = CreateWorkflow(StringLengthTask);
