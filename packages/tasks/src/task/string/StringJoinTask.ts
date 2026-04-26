/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecutePreviewContext,
  Task,
  TaskConfig,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";

const inputSchema = {
  type: "object",
  properties: {
    texts: {
      type: "array",
      items: { type: "string" },
      title: "Texts",
      description: "Array of strings to join",
    },
    separator: {
      type: "string",
      title: "Separator",
      description: "Separator between elements",
      default: "",
    },
  },
  required: ["texts"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "Joined string",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringJoinTaskInput = FromSchema<typeof inputSchema>;
export type StringJoinTaskOutput = FromSchema<typeof outputSchema>;

export class StringJoinTask<
  Input extends StringJoinTaskInput = StringJoinTaskInput,
  Output extends StringJoinTaskOutput = StringJoinTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "StringJoinTask";
  static override readonly category = "String";
  public static override title = "Join";
  public static override description = "Joins an array of strings with a separator";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    const separator = input.separator ?? "";
    return { text: input.texts.join(separator) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringJoin: CreateWorkflow<StringJoinTaskInput, StringJoinTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.stringJoin = CreateWorkflow(StringJoinTask);
