/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnyVectorRepository, TypeVectorRepository } from "@workglow/storage";
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
  TypedArraySchema,
  TypedArraySchemaOptions,
} from "@workglow/util";
import { TypeSingleOrArray } from "./base/AiTaskSchemas";

const inputSchema = {
  type: "object",
  properties: {
    docId: {
      type: "string",
      title: "Document ID",
      description: "The document ID",
    },
    repository: TypeVectorRepository({
      title: "Vector Repository",
      description: "The vector repository instance to store vectors in",
    }),
    vectors: TypeSingleOrArray(
      TypedArraySchema({
        title: "Vector",
        description: "The vector embedding",
      })
    ),
    metadata: {
      type: "object",
      title: "Metadata",
      description: "Metadata associated with the vector",
    },
  },
  required: ["repository", "docId", "vectors", "metadata"],
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
    docId: {
      type: "string",
      title: "Document ID",
      description: "The document ID",
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

export type VectorStoreUpsertTaskInput = FromSchema<
  typeof inputSchema,
  TypedArraySchemaOptions // & TypeVectorRepositoryOptions
>;
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
    const { repository, docId, vectors, metadata } = input;

    // Normalize inputs to arrays
    const vectorArray = Array.isArray(vectors) ? vectors : [vectors];

    const repo = repository as AnyVectorRepository;

    await context.updateProgress(1, "Upserting vectors");

    const idArray: string[] = [];

    // Bulk upsert if multiple items
    if (vectorArray.length > 1) {
      const entities = vectorArray.map((vector, i) => {
        const id = `${docId}_${i}`;
        idArray.push(id);
        return {
          id,
          docId,
          vector: vector as any, // Store TypedArray directly (memory) or as string (SQL)
          metadata,
        };
      });
      await repo.putBulk(entities as any);
    } else if (vectorArray.length === 1) {
      // Single upsert
      const id = `${docId}_0`;
      idArray.push(id);
      await repo.put({
        id,
        docId,
        vector: vectorArray[0] as any, // Store TypedArray directly (memory) or as string (SQL)
        metadata,
      } as any);
    }

    return {
      docId,
      ids: idArray,
      count: vectorArray.length,
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
