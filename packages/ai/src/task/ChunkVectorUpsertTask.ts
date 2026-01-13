/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnyChunkVectorRepository, TypeChunkVectorRepository } from "@workglow/storage";
import {
  CreateWorkflow,
  IExecuteContext,
  JobQueueTaskConfig,
  Task,
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
    repository: TypeChunkVectorRepository({
      title: "Document Chunk Vector Repository",
      description: "The document chunk vector repository instance to store vectors in",
    }),
    doc_id: {
      type: "string",
      title: "Document ID",
      description: "The document ID",
    },
    vectors: TypeSingleOrArray(
      TypedArraySchema({
        title: "Vectors",
        description: "The vector embeddings",
      })
    ),
    metadata: TypeSingleOrArray({
      type: "object",
      title: "Metadata",
      description: "Metadata associated with the vector",
      additionalProperties: true,
    }),
  },
  required: ["repository", "doc_id", "vectors", "metadata"],
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
    doc_id: {
      type: "string",
      title: "Document ID",
      description: "The document ID",
    },
    chunk_ids: {
      type: "array",
      items: { type: "string" },
      title: "Chunk IDs",
      description: "Chunk IDs of upserted vectors",
    },
  },
  required: ["count", "doc_id", "chunk_ids"],
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
export class ChunkVectorUpsertTask extends Task<
  VectorStoreUpsertTaskInput,
  VectorStoreUpsertTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "ChunkVectorUpsertTask";
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
    const { repository, doc_id, vectors, metadata } = input;

    // Normalize inputs to arrays
    const vectorArray = Array.isArray(vectors) ? vectors : [vectors];
    const metadataArray = Array.isArray(metadata)
      ? metadata
      : Array(vectorArray.length).fill(metadata);

    const repo = repository as AnyChunkVectorRepository;

    await context.updateProgress(1, "Upserting vectors");

    const chunk_ids: string[] = [];

    // Bulk upsert if multiple items
    if (vectorArray.length > 1) {
      if (vectorArray.length !== metadataArray.length) {
        throw new Error("Mismatch: vectors and metadata arrays must have the same length");
      }
      const entities = vectorArray.map((vector, i) => {
        const chunk_id = `${doc_id}_${i}`;
        const metadataItem = metadataArray[i];
        chunk_ids.push(chunk_id);
        return {
          chunk_id,
          doc_id,
          vector,
          metadata: metadataItem,
        };
      });
      await repo.putBulk(entities);
    } else if (vectorArray.length === 1) {
      // Single upsert
      const chunk_id = `${doc_id}_0`;
      const metadataItem = metadataArray[0];
      chunk_ids.push(chunk_id);
      await repo.put({
        chunk_id,
        doc_id,
        vector: vectorArray[0],
        metadata: metadataItem,
      });
    }

    return {
      doc_id,
      chunk_ids,
      count: chunk_ids.length,
    };
  }
}

export const vectorStoreUpsert = (
  input: VectorStoreUpsertTaskInput,
  config?: JobQueueTaskConfig
) => {
  return new ChunkVectorUpsertTask({} as VectorStoreUpsertTaskInput, config).run(input);
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

Workflow.prototype.vectorStoreUpsert = CreateWorkflow(ChunkVectorUpsertTask);
