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
      description: "Minimum value",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ScalarMinTaskInput = FromSchema<typeof inputSchema>;
export type ScalarMinTaskOutput = FromSchema<typeof outputSchema>;

export class ScalarMinTask<
  Input extends ScalarMinTaskInput = ScalarMinTaskInput,
  Output extends ScalarMinTaskOutput = ScalarMinTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "ScalarMinTask";
  static readonly category = "Math";
  public static title = "Min";
  public static description = "Returns the smallest of the given numbers";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async execute(input: Input, _context: IExecuteContext): Promise<Output> {
    return { result: Math.min(...input.values) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    scalarMin: CreateWorkflow<ScalarMinTaskInput, ScalarMinTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.scalarMin = CreateWorkflow(ScalarMinTask);
