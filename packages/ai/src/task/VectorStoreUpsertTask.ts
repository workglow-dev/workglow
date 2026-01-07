/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IVectorRepository, TypeVectorRepository } from "@workglow/storage";
import {
  CreateWorkflow,
  IExecuteContext,
  JobQueueTaskConfig,
  Task,
  TaskRegistry,
  Workflow,
} from "@workglow/task-graph";
import {
  DataPortSchema,
  FromSchema,
  TypedArray,
  TypedArraySchema,
  TypedArraySchemaOptions,
} from "@workglow/util";

const inputSchema = {
  type: "object",
  properties: {
    repository: TypeVectorRepository({
      title: "Vector Repository",
      description: "The vector repository instance to store vectors in",
    }),
    ids: {
      oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
      title: "IDs",
      description: "Unique identifier(s) for the vector(s)",
    },
    vectors: {
      oneOf: [
        TypedArraySchema({
          title: "Vector",
          description: "The vector embedding",
        }),
        {
          type: "array",
          items: TypedArraySchema({
            title: "Vector",
            description: "The vector embedding",
          }),
        },
      ],
      title: "Vectors",
      description: "Vector embedding(s) to store",
    },
    metadata: {
      oneOf: [
        {
          type: "object",
          title: "Metadata",
          description: "Metadata associated with the vector",
        },
        {
          type: "array",
          items: {
            type: "object",
            title: "Metadata",
            description: "Metadata associated with the vector",
          },
        },
      ],
      title: "Metadata",
      description: "Metadata associated with the vector(s)",
    },
  },
  required: ["repository", "ids", "vectors", "metadata"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    count: {
      type: "number",
      title: "Count",
      description: "Number of vectors upserted",
    },
    ids: {
      type: "array",
      items: { type: "string" },
      title: "IDs",
      description: "IDs of upserted vectors",
    },
  },
  required: ["count", "ids"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type VectorStoreUpsertTaskInput = FromSchema<typeof inputSchema, TypedArraySchemaOptions>;
export type VectorStoreUpsertTaskOutput = FromSchema<typeof outputSchema>;

/**
 * Task for upserting (insert or update) vectors into a vector repository.
 * Supports both single and bulk operations.
 */
export class VectorStoreUpsertTask extends Task<
  VectorStoreUpsertTaskInput,
  VectorStoreUpsertTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "VectorStoreUpsertTask";
  public static category = "Vector Store";
  public static title = "Vector Store Upsert";
  public static description = "Store vector embeddings with metadata in a vector repository";
  public static cacheable = false; // Has side effects

  public static inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  async execute(
    input: VectorStoreUpsertTaskInput,
    context: IExecuteContext
  ): Promise<VectorStoreUpsertTaskOutput> {
    const { repository, ids, vectors, metadata } = input;

    // Normalize inputs to arrays
    const idArray = Array.isArray(ids) ? ids : [ids];
    const vectorArray = Array.isArray(vectors) ? vectors : [vectors];
    const metadataArray = Array.isArray(metadata) ? metadata : [metadata];

    // Validate lengths match
    if (idArray.length !== vectorArray.length || idArray.length !== metadataArray.length) {
      throw new Error(
        `Mismatched array lengths: ids(${idArray.length}), vectors(${vectorArray.length}), metadata(${metadataArray.length})`
      );
    }

    const repo = repository as IVectorRepository<any, TypedArray>;

    await context.updateProgress(1, "Upserting vectors");

    // Bulk upsert if multiple items
    if (idArray.length > 1) {
      const entries = idArray.map((id, i) => ({
        id,
        vector: vectorArray[i],
        metadata: metadataArray[i],
      }));
      await repo.upsertBulk(entries);
    } else if (idArray.length === 1) {
      // Single upsert
      await repo.upsert(idArray[0], vectorArray[0], metadataArray[0]);
    }

    return {
      count: idArray.length,
      ids: idArray,
    };
  }
}

TaskRegistry.registerTask(VectorStoreUpsertTask);

export const vectorStoreUpsert = (
  input: VectorStoreUpsertTaskInput,
  config?: JobQueueTaskConfig
) => {
  return new VectorStoreUpsertTask({} as VectorStoreUpsertTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    vectorStoreUpsert: CreateWorkflow<
      VectorStoreUpsertTaskInput,
      VectorStoreUpsertTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.vectorStoreUpsert = CreateWorkflow(VectorStoreUpsertTask);
