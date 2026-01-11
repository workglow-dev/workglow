/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, Task, TaskConfig, TaskRegistry, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";

const inputSchema = {
  type: "object",
  properties: {
    input: {
      title: "Single Input",
      description: "A single value to output",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as const satisfies DataPortSchema;

export type SplitTaskInput = FromSchema<typeof inputSchema>;
export type SplitTaskOutput = FromSchema<typeof outputSchema>;

/**
 * SplitTask takes an array or single value as input and creates
 * separate outputs for each element. Each output is named by its index (0, 1, 2, etc.).
 * Useful for workflows that need to process array elements in parallel branches.
 *
 * Features:
 * - Accepts both arrays and single values as input
 * - Creates one output per array element (output_0, output_1, etc.)
 * - Single values are treated as a single-element array
 * - Output count matches array length
 *
 * Example:
 * Input: { input: [1, 2, 3] }
 * Output: { output_0: 1, output_1: 2, output_2: 3 }
 */
export class SplitTask<
  Input extends SplitTaskInput = SplitTaskInput,
  Output extends SplitTaskOutput = SplitTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  public static type = "SplitTask";
  public static category = "Utility";
  public static title = "Split";
  public static description =
    "Splits an array into individual outputs, creating one output per element";
  static hasDynamicSchemas = true;
  static readonly cacheable = false;

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  public outputSchema(): DataPortSchema {
    return outputSchema;
  }

  async executeReactive(input: Input): Promise<Output> {
    const inputValue = input.input;
    const output = {} as Output;

    // Handle array input
    if (Array.isArray(inputValue)) {
      inputValue.forEach((item, index) => {
        (output as any)[`output_${index}`] = item;
      });
    } else {
      // Handle single value as a single-element array
      (output as any).output_0 = inputValue;
    }

    return output;
  }
}

TaskRegistry.registerTask(SplitTask);

export const split = (input: SplitTaskInput, config: TaskConfig = {}) => {
  const task = new SplitTask({}, config);
  return task.run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    split: CreateWorkflow<SplitTaskInput, SplitTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.split = CreateWorkflow(SplitTask);
