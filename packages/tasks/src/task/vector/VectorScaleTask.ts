/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import {
  createTypedArrayFrom,
  DataPortSchema,
  FromSchema,
  TypedArraySchema,
  TypedArraySchemaOptions,
} from "@workglow/util";

const inputSchema = {
  type: "object",
  properties: {
    vector: TypedArraySchema({
      title: "Vector",
      description: "Input vector",
    }),
    scalar: {
      type: "number",
      title: "Scalar",
      description: "Scalar multiplier",
    },
  },
  required: ["vector", "scalar"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: TypedArraySchema({
      title: "Result",
      description: "Scaled vector",
    }),
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type VectorScaleTaskInput = FromSchema<typeof inputSchema, TypedArraySchemaOptions>;
export type VectorScaleTaskOutput = FromSchema<typeof outputSchema, TypedArraySchemaOptions>;

export class VectorScaleTask<
  Input extends VectorScaleTaskInput = VectorScaleTaskInput,
  Output extends VectorScaleTaskOutput = VectorScaleTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "VectorScaleTask";
  static readonly category = "Vector";
  public static title = "Scale";
  public static description = "Multiplies each element of a vector by a scalar";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async execute(input: Input, _context: IExecuteContext): Promise<Output> {
    const { vector, scalar } = input;
    const values = Array.from(vector, (v) => Number(v) * scalar);
    return { result: createTypedArrayFrom([vector], values) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    vectorScale: CreateWorkflow<VectorScaleTaskInput, VectorScaleTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.vectorScale = CreateWorkflow(VectorScaleTask);
