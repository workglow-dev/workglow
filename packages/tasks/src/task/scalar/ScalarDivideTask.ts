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
      description: "Numerator",
    },
    b: {
      type: "number",
      title: "B",
      description: "Denominator",
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
      description: "Quotient (a / b)",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ScalarDivideTaskInput = FromSchema<typeof inputSchema>;
export type ScalarDivideTaskOutput = FromSchema<typeof outputSchema>;

export class ScalarDivideTask<
  Input extends ScalarDivideTaskInput = ScalarDivideTaskInput,
  Output extends ScalarDivideTaskOutput = ScalarDivideTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "ScalarDivideTask";
  static readonly category = "Math";
  public static title = "Divide";
  public static description = "Returns the quotient of two numbers (a / b)";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async execute(input: Input, _context: IExecuteContext): Promise<Output> {
    return { result: input.a / input.b } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    scalarDivide: CreateWorkflow<ScalarDivideTaskInput, ScalarDivideTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.scalarDivide = CreateWorkflow(ScalarDivideTask);
