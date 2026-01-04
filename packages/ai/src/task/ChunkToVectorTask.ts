/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

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
import { ChunkNodeSchema, type ChunkNode } from "../source/DocumentSchema";

const inputSchema = {
  type: "object",
  properties: {
    docId: {
      type: "string",
      title: "Document ID",
      description: "The document ID",
    },
    chunks: {
      type: "array",
      items: ChunkNodeSchema(),
      title: "Chunks",
      description: "Array of chunk nodes",
    },
    vectors: {
      type: "array",
      items: TypedArraySchema({
        title: "Vector",
        description: "Vector embedding",
      }),
      title: "Vectors",
      description: "Embeddings from TextEmbeddingTask",
    },
  },
  required: [],
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
 * Task to transform chunk nodes and embeddings into vector store format
 * Bridges HierarchicalChunker + TextEmbedding → VectorStoreUpsert
 */
export class ChunkToVectorTask extends Task<
  ChunkToVectorTaskInput,
  ChunkToVectorTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "ChunkToVectorTask";
  public static category = "Document";
  public static title = "Chunk to Vector Transform";
  public static description = "Transform chunks and embeddings to vector store format";
  public static cacheable = true;

  public static inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  async execute(
    input: ChunkToVectorTaskInput,
    context: IExecuteContext
  ): Promise<ChunkToVectorTaskOutput> {
    const { docId, chunks, vectors } = input;

    const chunkArray = chunks as ChunkNode[];

    if (!chunkArray || !vectors) {
      throw new Error("Both chunks and vector are required");
    }

    if (chunkArray.length !== vectors.length) {
      throw new Error(`Mismatch: ${chunkArray.length} chunks but ${vectors.length} vectors`);
    }

    const ids: string[] = [];
    const metadata: any[] = [];
    const texts: string[] = [];

    for (let i = 0; i < chunkArray.length; i++) {
      const chunk = chunkArray[i];

      ids.push(chunk.chunkId);
      texts.push(chunk.text);

      metadata.push({
        docId: chunk.docId,
        configId: chunk.configId,
        chunkId: chunk.chunkId,
        leafNodeId: chunk.nodePath[chunk.nodePath.length - 1],
        depth: chunk.depth,
        text: chunk.text,
        nodePath: chunk.nodePath,
        // Include enrichment if present
        ...(chunk.enrichment || {}),
      });
    }

    return {
      ids,
      vectors,
      metadata,
      texts,
    };
  }
}

TaskRegistry.registerTask(ChunkToVectorTask);

export const chunkToVector = (input: ChunkToVectorTaskInput, config?: JobQueueTaskConfig) => {
  return new ChunkToVectorTask({} as ChunkToVectorTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    chunkToVector: CreateWorkflow<
      ChunkToVectorTaskInput,
      ChunkToVectorTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.chunkToVector = CreateWorkflow(ChunkToVectorTask);
