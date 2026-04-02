/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChunkRecordSchema, type ChunkRecord } from "@workglow/knowledge-base";
import { CreateWorkflow, IExecuteContext, TaskConfig, Task, Workflow } from "@workglow/task-graph";
import {
  DataPortSchema,
  FromSchema,
  TypedArraySchema,
  TypedArraySchemaOptions,
} from "@workglow/util/schema";

const inputSchema = {
  type: "object",
  properties: {
    doc_id: {
      type: "string",
      title: "Document ID",
      description: "The document ID",
    },
    doc_title: {
      type: "string",
      title: "Document Title",
      description: "Human-readable title for the source document",
    },
    chunks: {
      type: "array",
      items: ChunkRecordSchema(),
      title: "Chunks",
      description: "Array of chunk records",
    },
    vector: {
      type: "array",
      items: TypedArraySchema({
        title: "Vector",
        description: "Vector embedding",
      }),
      title: "Vectors",
      description: "Embeddings from TextEmbeddingTask",
    },
  },
  required: ["chunks", "vector"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    ids: {
      type: "array",
      items: { type: "string" },
      title: "IDs",
      description: "Chunk IDs for vector store",
    },
    vectors: {
      type: "array",
      items: TypedArraySchema({
        title: "Vector",
        description: "Vector embedding",
      }),
      title: "Vectors",
      description: "Vector embeddings",
    },
    metadata: {
      type: "array",
      items: {
        type: "object",
        title: "Metadata",
        description: "Metadata for vector store",
      },
      title: "Metadata",
      description: "Metadata for each vector",
    },
    texts: {
      type: "array",
      items: { type: "string" },
      title: "Texts",
      description: "Chunk texts (for reference)",
    },
  },
  required: ["ids", "vectors", "metadata", "texts"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ChunkToVectorTaskInput = FromSchema<typeof inputSchema, TypedArraySchemaOptions>;
export type ChunkToVectorTaskOutput = FromSchema<typeof outputSchema, TypedArraySchemaOptions>;

/**
 * Task to transform chunk records and embeddings into vector store format
 * Bridges HierarchicalChunker + TextEmbedding -> VectorStoreUpsert
 */
export class ChunkToVectorTask extends Task<
  ChunkToVectorTaskInput,
  ChunkToVectorTaskOutput,
  TaskConfig
> {
  public static override type = "ChunkToVectorTask";
  public static override category = "Document";
  public static override title = "Chunk to Vector";
  public static override description = "Transform chunks and embeddings to vector store format";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: ChunkToVectorTaskInput,
    context: IExecuteContext
  ): Promise<ChunkToVectorTaskOutput> {
    const { chunks, vector, doc_title } = input;

    const chunkArray = chunks as ChunkRecord[];

    if (!chunkArray || !vector) {
      throw new Error("Both chunks and vector are required");
    }

    if (chunkArray.length !== vector.length) {
      throw new Error(`Mismatch: ${chunkArray.length} chunks but ${vector.length} vectors`);
    }

    const ids: string[] = [];
    const metadata: ChunkRecord[] = [];
    const texts: string[] = [];

    for (let i = 0; i < chunkArray.length; i++) {
      const chunk = chunkArray[i];

      ids.push(chunk.chunkId);
      texts.push(chunk.text);

      metadata.push({
        doc_id: chunk.doc_id,
        chunkId: chunk.chunkId,
        leafNodeId: chunk.nodePath[chunk.nodePath.length - 1],
        depth: chunk.depth,
        text: chunk.text,
        nodePath: chunk.nodePath,
        ...(doc_title ? { doc_title } : {}),
        ...(chunk.summary ? { summary: chunk.summary } : {}),
        ...(chunk.entities ? { entities: chunk.entities } : {}),
      });
    }

    return {
      ids,
      vectors: vector,
      metadata,
      texts,
    };
  }
}

export const chunkToVector = (input: ChunkToVectorTaskInput, config?: TaskConfig) => {
  return new ChunkToVectorTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    chunkToVector: CreateWorkflow<ChunkToVectorTaskInput, ChunkToVectorTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.chunkToVector = CreateWorkflow(ChunkToVectorTask);
