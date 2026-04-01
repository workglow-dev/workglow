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
    template: {
      type: "string",
      title: "Template",
      description: "Template string with {{key}} placeholders",
    },
    values: {
      type: "object",
      title: "Values",
      description: "Key-value pairs to substitute into the template",
      additionalProperties: true,
    },
  },
  required: ["template", "values"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: {
      type: "string",
      title: "Result",
      description: "Template with placeholders replaced by values",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StringTemplateTaskInput = FromSchema<typeof inputSchema>;
export type StringTemplateTaskOutput = FromSchema<typeof outputSchema>;

/**
 * @deprecated Use {@link TemplateTask} instead, which supports dot-notation paths
 * and `{{key|default}}` fallback syntax.
 */
export class StringTemplateTask<
  Input extends StringTemplateTaskInput = StringTemplateTaskInput,
  Output extends StringTemplateTaskOutput = StringTemplateTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "StringTemplateTask";
  static override readonly category = "String";
  public static override title = "Template";
  public static override description = "Replaces {{key}} placeholders in a template string with values";

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
    let result = input.template;
    for (const [key, value] of Object.entries(input.values)) {
      result = result.replaceAll(`{{${key}}}`, String(value));
    }
    return { result } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    stringTemplate: CreateWorkflow<StringTemplateTaskInput, StringTemplateTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.stringTemplate = CreateWorkflow(StringTemplateTask);
