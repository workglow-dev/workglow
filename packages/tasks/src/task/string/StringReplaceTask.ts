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
    search: {
      type: "string",
      title: "Search",
      description: "Substring to search for",
    },
    replace: {
      type: "string",
      title: "Replace",
      description: "Replacement string",
    },
  },
  required: ["value", "search", "replace"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: {
      type: "string",
      title: "Result",
      description: "String with all occurrences replaced",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringReplaceTaskInput = FromSchema<typeof inputSchema>;
export type StringReplaceTaskOutput = FromSchema<typeof outputSchema>;

export class StringReplaceTask<
  Input extends StringReplaceTaskInput = StringReplaceTaskInput,
  Output extends StringReplaceTaskOutput = StringReplaceTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "StringReplaceTask";
  static readonly category = "String";
  public static title = "Replace";
  public static description = "Replaces all occurrences of a substring";

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
    return { result: input.value.replaceAll(input.search, input.replace) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringReplace: CreateWorkflow<StringReplaceTaskInput, StringReplaceTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.stringReplace = CreateWorkflow(StringReplaceTask);
