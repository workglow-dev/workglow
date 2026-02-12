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
      type: "number",
      title: "A",
      description: "First number",
    },
    b: {
      type: "number",
      title: "B",
      description: "Second number",
    },
  },
  required: ["a", "b"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: {
      type: "number",
      title: "Result",
      description: "Product of a and b",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ScalarMultiplyTaskInput = FromSchema<typeof inputSchema>;
export type ScalarMultiplyTaskOutput = FromSchema<typeof outputSchema>;

export class ScalarMultiplyTask<
  Input extends ScalarMultiplyTaskInput = ScalarMultiplyTaskInput,
  Output extends ScalarMultiplyTaskOutput = ScalarMultiplyTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "ScalarMultiplyTask";
  static readonly category = "Math";
  public static title = "Multiply";
  public static description = "Returns the product of two numbers";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async execute(input: Input, _context: IExecuteContext): Promise<Output> {
    return { result: input.a * input.b } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    scalarMultiply: CreateWorkflow<ScalarMultiplyTaskInput, ScalarMultiplyTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.scalarMultiply = CreateWorkflow(ScalarMultiplyTask);
