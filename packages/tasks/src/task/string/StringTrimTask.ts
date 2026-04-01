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
      description: "Trimmed string",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringTrimTaskInput = FromSchema<typeof inputSchema>;
export type StringTrimTaskOutput = FromSchema<typeof outputSchema>;

export class StringTrimTask<
  Input extends StringTrimTaskInput = StringTrimTaskInput,
  Output extends StringTrimTaskOutput = StringTrimTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "StringTrimTask";
  static override readonly category = "String";
  public static override title = "Trim";
  public static override description = "Removes leading and trailing whitespace from a string";

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
    return { result: input.value.trim() } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringTrim: CreateWorkflow<StringTrimTaskInput, StringTrimTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.stringTrim = CreateWorkflow(StringTrimTask);
