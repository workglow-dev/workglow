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
    value: {
      type: "number",
      title: "Value",
      description: "Input number",
    },
  },
  required: ["value"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: {
      type: "number",
      title: "Result",
      description: "Absolute value",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ScalarAbsTaskInput = FromSchema<typeof inputSchema>;
export type ScalarAbsTaskOutput = FromSchema<typeof outputSchema>;

export class ScalarAbsTask<
  Input extends ScalarAbsTaskInput = ScalarAbsTaskInput,
  Output extends ScalarAbsTaskOutput = ScalarAbsTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "ScalarAbsTask";
  static readonly category = "Math";
  public static title = "Abs";
  public static description = "Returns the absolute value of a number";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async execute(input: Input, _context: IExecuteContext): Promise<Output> {
    return { result: Math.abs(input.value) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    scalarAbs: CreateWorkflow<ScalarAbsTaskInput, ScalarAbsTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.scalarAbs = CreateWorkflow(ScalarAbsTask);
