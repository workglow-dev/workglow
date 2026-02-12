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
      description: "Floored value",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ScalarFloorTaskInput = FromSchema<typeof inputSchema>;
export type ScalarFloorTaskOutput = FromSchema<typeof outputSchema>;

export class ScalarFloorTask<
  Input extends ScalarFloorTaskInput = ScalarFloorTaskInput,
  Output extends ScalarFloorTaskOutput = ScalarFloorTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "ScalarFloorTask";
  static readonly category = "Math";
  public static title = "Floor";
  public static description = "Returns the largest integer less than or equal to a number";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async execute(input: Input, _context: IExecuteContext): Promise<Output> {
    return { result: Math.floor(input.value) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    scalarFloor: CreateWorkflow<ScalarFloorTaskInput, ScalarFloorTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.scalarFloor = CreateWorkflow(ScalarFloorTask);
