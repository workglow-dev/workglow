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
    text: {
      type: "string",
      title: "Text",
      description: "Trimmed string",
    },
  },
  required: ["text"],
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

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return { text: input.text.trim() } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringTrim: CreateWorkflow<StringTrimTaskInput, StringTrimTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.stringTrim = CreateWorkflow(StringTrimTask);
