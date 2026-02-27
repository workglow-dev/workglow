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
    a: {
      type: "string",
      title: "A",
      description: "First string",
    },
    b: {
      type: "string",
      title: "B",
      description: "Second string",
    },
  },
  required: ["a", "b"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: {
      type: "string",
      title: "Result",
      description: "Concatenation of a and b",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringConcatTaskInput = FromSchema<typeof inputSchema>;
export type StringConcatTaskOutput = FromSchema<typeof outputSchema>;

export class StringConcatTask<
  Input extends StringConcatTaskInput = StringConcatTaskInput,
  Output extends StringConcatTaskOutput = StringConcatTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "StringConcatTask";
  static readonly category = "String";
  public static title = "Concat";
  public static description = "Concatenates two strings";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async execute(input: Input, _context: IExecuteContext): Promise<Output> {
    return { result: input.a + input.b } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringConcat: CreateWorkflow<StringConcatTaskInput, StringConcatTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.stringConcat = CreateWorkflow(StringConcatTask);
