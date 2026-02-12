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
      description: "Rounded value",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ScalarRoundTaskInput = FromSchema<typeof inputSchema>;
export type ScalarRoundTaskOutput = FromSchema<typeof outputSchema>;

export class ScalarRoundTask<
  Input extends ScalarRoundTaskInput = ScalarRoundTaskInput,
  Output extends ScalarRoundTaskOutput = ScalarRoundTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "ScalarRoundTask";
  static readonly category = "Math";
  public static title = "Round";
  public static description = "Returns the value of a number rounded to the nearest integer";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async execute(input: Input, _context: IExecuteContext): Promise<Output> {
    return { result: Math.round(input.value) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    scalarRound: CreateWorkflow<ScalarRoundTaskInput, ScalarRoundTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.scalarRound = CreateWorkflow(ScalarRoundTask);
