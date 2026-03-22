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
      description: "Input string to search in",
    },
    search: {
      type: "string",
      title: "Search",
      description: "Substring to search for",
    },
  },
  required: ["value", "search"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: {
      type: "boolean",
      title: "Result",
      description: "Whether the string contains the search substring",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringIncludesTaskInput = FromSchema<typeof inputSchema>;
export type StringIncludesTaskOutput = FromSchema<typeof outputSchema>;

export class StringIncludesTask<
  Input extends StringIncludesTaskInput = StringIncludesTaskInput,
  Output extends StringIncludesTaskOutput = StringIncludesTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "StringIncludesTask";
  static readonly category = "String";
  public static title = "Includes";
  public static description = "Checks if a string contains a substring";

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
    return { result: input.value.includes(input.search) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringIncludes: CreateWorkflow<StringIncludesTaskInput, StringIncludesTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.stringIncludes = CreateWorkflow(StringIncludesTask);
