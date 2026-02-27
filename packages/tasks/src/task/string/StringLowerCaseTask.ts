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
      description: "Lowercased string",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringLowerCaseTaskInput = FromSchema<typeof inputSchema>;
export type StringLowerCaseTaskOutput = FromSchema<typeof outputSchema>;

export class StringLowerCaseTask<
  Input extends StringLowerCaseTaskInput = StringLowerCaseTaskInput,
  Output extends StringLowerCaseTaskOutput = StringLowerCaseTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "StringLowerCaseTask";
  static readonly category = "String";
  public static title = "Lower Case";
  public static description = "Converts a string to lower case";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async execute(input: Input, _context: IExecuteContext): Promise<Output> {
    return { result: input.value.toLowerCase() } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringLowerCase: CreateWorkflow<
      StringLowerCaseTaskInput,
      StringLowerCaseTaskOutput,
      TaskConfig
    >;
  }
}

Workflow.prototype.stringLowerCase = CreateWorkflow(StringLowerCaseTask);
