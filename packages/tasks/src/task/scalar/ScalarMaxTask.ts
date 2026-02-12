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
    values: {
      type: "array",
      items: { type: "number" },
      title: "Values",
      description: "Array of numbers",
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
      description: "Maximum value",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ScalarMaxTaskInput = FromSchema<typeof inputSchema>;
export type ScalarMaxTaskOutput = FromSchema<typeof outputSchema>;

export class ScalarMaxTask<
  Input extends ScalarMaxTaskInput = ScalarMaxTaskInput,
  Output extends ScalarMaxTaskOutput = ScalarMaxTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "ScalarMaxTask";
  static readonly category = "Math";
  public static title = "Max";
  public static description = "Returns the largest of the given numbers";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async execute(input: Input, _context: IExecuteContext): Promise<Output> {
    return { result: Math.max(...input.values) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    scalarMax: CreateWorkflow<ScalarMaxTaskInput, ScalarMaxTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.scalarMax = CreateWorkflow(ScalarMaxTask);
