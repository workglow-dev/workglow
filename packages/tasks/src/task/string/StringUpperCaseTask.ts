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
      description: "Uppercased string",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringUpperCaseTaskInput = FromSchema<typeof inputSchema>;
export type StringUpperCaseTaskOutput = FromSchema<typeof outputSchema>;

export class StringUpperCaseTask<
  Input extends StringUpperCaseTaskInput = StringUpperCaseTaskInput,
  Output extends StringUpperCaseTaskOutput = StringUpperCaseTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "StringUpperCaseTask";
  static readonly category = "String";
  public static title = "Upper Case";
  public static description = "Converts a string to upper case";

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
    return { result: input.value.toUpperCase() } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringUpperCase: CreateWorkflow<
      StringUpperCaseTaskInput,
      StringUpperCaseTaskOutput,
      TaskConfig
    >;
  }
}

Workflow.prototype.stringUpperCase = CreateWorkflow(StringUpperCaseTask);
