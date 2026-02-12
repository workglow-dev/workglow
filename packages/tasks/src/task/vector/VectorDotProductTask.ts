/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import {
  DataPortSchema,
  FromSchema,
  TypedArray,
  TypedArraySchema,
  TypedArraySchemaOptions,
} from "@workglow/util";
import { sumPrecise } from "../scalar/sumPrecise";

const inputSchema = {
  type: "object",
  properties: {
    vectors: {
      type: "array",
      items: TypedArraySchema({
        title: "Vector",
        description: "Vector for dot product",
      }),
      title: "Vectors",
      description: "Array of two vectors to compute dot product",
    },
  },
  required: ["vectors"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    result: {
      type: "number",
      title: "Result",
      description: "Dot product of the vectors",
    },
  },
  required: ["result"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type VectorDotProductTaskInput = FromSchema<typeof inputSchema, TypedArraySchemaOptions>;
export type VectorDotProductTaskOutput = FromSchema<typeof outputSchema>;

export class VectorDotProductTask<
  Input extends VectorDotProductTaskInput = VectorDotProductTaskInput,
  Output extends VectorDotProductTaskOutput = VectorDotProductTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static readonly type = "VectorDotProductTask";
  static readonly category = "Vector";
  public static title = "Dot Product";
  public static description = "Returns the dot (inner) product of the first two vectors";

  static inputSchema() {
    return inputSchema;
  }

  static outputSchema() {
    return outputSchema;
  }

  async execute(input: Input, _context: IExecuteContext): Promise<Output> {
    const { vectors } = input as { vectors: TypedArray[] };
    if (vectors.length < 2) {
      throw new Error("Exactly two vectors are required for dot product");
    }
    const [a, b] = vectors;
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same length");
    }
    const products = Array.from({ length: a.length }, (_, i) =>
      Number(a[i]) * Number(b[i]),
    );
    return { result: sumPrecise(products) } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    vectorDotProduct: CreateWorkflow<
      VectorDotProductTaskInput,
      VectorDotProductTaskOutput,
      TaskConfig
    >;
  }
}

Workflow.prototype.vectorDotProduct = CreateWorkflow(VectorDotProductTask);
