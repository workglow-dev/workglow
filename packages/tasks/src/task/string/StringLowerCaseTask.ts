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
      description: "Lowercased string",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringLowerCaseTaskInput = FromSchema<typeof inputSchema>;
export type StringLowerCaseTaskOutput = FromSchema<typeof outputSchema>;

export class StringLowerCaseTask<
  Input extends StringLowerCaseTaskInput = StringLowerCaseTaskInput,
  Output extends StringLowerCaseTaskOutput = StringLowerCaseTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "StringLowerCaseTask";
  static override readonly category = "String";
  public static override title = "Lower Case";
  public static override description = "Converts a string to lower case";

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
    return { text: input.text.toLowerCase() } as Output;
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
