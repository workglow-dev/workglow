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
    values: {
      type: "array",
      items: { type: "string" },
      title: "Values",
      description: "Array of strings to join",
    },
    separator: {
      type: "string",
      title: "Separator",
      description: "Separator between elements",
      default: "",
    },
  },
  required: ["values"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: {
      type: "string",
      title: "Result",
      description: "Joined string",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringJoinTaskInput = FromSchema<typeof inputSchema>;
export type StringJoinTaskOutput = FromSchema<typeof outputSchema>;

export class StringJoinTask<
  Input extends StringJoinTaskInput = StringJoinTaskInput,
  Output extends StringJoinTaskOutput = StringJoinTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "StringJoinTask";
  static readonly category = "String";
  public static title = "Join";
  public static description = "Joins an array of strings with a separator";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async executeReactive(
    input: Input,
    _output: Output,
    _context: IExecuteReactiveContext
  ): Promise<Output> {
    const separator = input.separator ?? "";
    return { result: input.values.join(separator) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringJoin: CreateWorkflow<StringJoinTaskInput, StringJoinTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.stringJoin = CreateWorkflow(StringJoinTask);
