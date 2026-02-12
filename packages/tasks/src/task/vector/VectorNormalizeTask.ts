/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import {
  DataPortSchema,
  FromSchema,
  TypedArraySchema,
  TypedArraySchemaOptions,
  normalize,
} from "@workglow/util";

const inputSchema = {
  type: "object",
  properties: {
    vector: TypedArraySchema({
      title: "Vector",
      description: "Input vector to normalize",
    }),
  },
  required: ["vector"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: TypedArraySchema({
      title: "Result",
      description: "L2-normalized vector",
    }),
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type VectorNormalizeTaskInput = FromSchema<typeof inputSchema, TypedArraySchemaOptions>;
export type VectorNormalizeTaskOutput = FromSchema<typeof outputSchema, TypedArraySchemaOptions>;

export class VectorNormalizeTask<
  Input extends VectorNormalizeTaskInput = VectorNormalizeTaskInput,
  Output extends VectorNormalizeTaskOutput = VectorNormalizeTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "VectorNormalizeTask";
  static readonly category = "Vector";
  public static title = "Normalize";
  public static description = "Returns the L2-normalized (unit length) vector";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async execute(input: Input, _context: IExecuteContext): Promise<Output> {
    return { result: normalize(input.vector) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    vectorNormalize: CreateWorkflow<
      VectorNormalizeTaskInput,
      VectorNormalizeTaskOutput,
      TaskConfig
    >;
  }
}

Workflow.prototype.vectorNormalize = CreateWorkflow(VectorNormalizeTask);
