/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { sumPrecise } from "./sumPrecise";

const inputSchema = {
  type: "object",
  properties: {
    values: {
      type: "array",
      items: { type: "number" },
      title: "Values",
      description: "Array of numbers to sum",
    },
  },
  required: ["values"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: {
      type: "number",
      title: "Result",
      description: "Sum of all values",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ScalarSumTaskInput = FromSchema<typeof inputSchema>;
export type ScalarSumTaskOutput = FromSchema<typeof outputSchema>;

export class ScalarSumTask<
  Input extends ScalarSumTaskInput = ScalarSumTaskInput,
  Output extends ScalarSumTaskOutput = ScalarSumTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "ScalarSumTask";
  static readonly category = "Math";
  public static title = "Sum";
  public static description = "Returns the sum of an array of numbers";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async execute(input: Input, _context: IExecuteContext): Promise<Output> {
    return { result: sumPrecise(input.values) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    scalarSum: CreateWorkflow<ScalarSumTaskInput, ScalarSumTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.scalarSum = CreateWorkflow(ScalarSumTask);
