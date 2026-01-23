/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DocumentChunk, DocumentChunkDataset, TypeDocumentChunkDataset } from "@workglow/dataset";
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
  isTypedArray,
  TypedArray,
  TypedArraySchema,
  TypedArraySchemaOptions,
} from "@workglow/util";
import { TypeModel, TypeSingleOrArray } from "./base/AiTaskSchemas";
import { TextEmbeddingTask } from "./TextEmbeddingTask";

const inputSchema = {
  type: "object",
  properties: {
    dataset: TypeDocumentChunkDataset({
      title: "Document Chunk Vector Repository",
      description: "The document chunk vector repository instance to search in",
    }),
    query: TypeSingleOrArray({
      oneOf: [
        { type: "string" },
        TypedArraySchema({
          title: "Query Vector",
          description: "Pre-computed query vector",
        }),
      ],
      title: "Query",
      description: "Query string or pre-computed query vector",
    }),
    model: TypeModel("model:TextEmbeddingTask", {
      title: "Model",
      description:
        "Text embedding model to use for query embedding (required when query is a string)",
    }),
    topK: {
      type: "number",
      title: "Top K",
      description: "Number of top results to return",
      minimum: 1,
      default: 5,
    },
    filter: {
      type: "object",
      title: "Metadata Filter",
      description: "Filter results by metadata fields",
    },
    scoreThreshold: {
      type: "number",
      title: "Score Threshold",
      description: "Minimum similarity score threshold (0-1)",
      minimum: 0,
      maximum: 1,
      default: 0,
    },
    returnVectors: {
      type: "boolean",
      title: "Return Vectors",
      description: "Whether to return vector embeddings in results",
      default: false,
    },
  },
  required: ["dataset", "query"],
  if: {
    properties: {
      query: { type: "string" },
    },
  },
  then: {
    required: ["dataset", "query", "model"],
  },
  else: {},
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    chunks: {
      type: "array",
      items: { type: "string" },
      title: "Text Chunks",
      description: "Retrieved text chunks",
    },
    chunk_ids: {
      type: "array",
      items: { type: "string" },
      title: "IDs",
      description: "IDs of retrieved chunks",
    },
    metadata: {
      type: "array",
      items: {
        type: "object",
        title: "Metadata",
        description: "Metadata of retrieved chunk",
      },
      title: "Metadata",
      description: "Metadata of retrieved chunks",
    },
    scores: {
      type: "array",
      items: { type: "number" },
      title: "Scores",
      description: "Similarity scores for each result",
    },
    vectors: {
      type: "array",
      items: TypedArraySchema({
        title: "Vector",
        description: "Vector embedding",
      }),
      title: "Vectors",
      description: "Vector embeddings (if returnVectors is true)",
    },
    count: {
      type: "number",
      title: "Count",
      description: "Number of results returned",
    },
  },
  required: ["chunks", "chunk_ids", "metadata", "scores", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ChunkRetrievalTaskInput = FromSchema<typeof inputSchema, TypedArraySchemaOptions>;
export type ChunkRetrievalTaskOutput = FromSchema<typeof outputSchema, TypedArraySchemaOptions>;

/**
 * End-to-end retrieval task that combines embedding generation (if needed) and vector search.
 * Simplifies the RAG pipeline by handling the full retrieval process.
 */
export class ChunkRetrievalTask extends Task<
  ChunkRetrievalTaskInput,
  ChunkRetrievalTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "ChunkRetrievalTask";
  public static category = "RAG";
  public static title = "Chunk Retrieval";
  public static description = "End-to-end retrieval: embed query and search for similar chunks";
  public static cacheable = true;

  public static inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  async execute(
    input: ChunkRetrievalTaskInput,
    context: IExecuteContext
  ): Promise<ChunkRetrievalTaskOutput> {
    const {
      dataset,
      query,
      topK = 5,
      filter,
      model,
      scoreThreshold = 0,
      returnVectors = false,
    } = input;

    // Repository is resolved by input resolver system before execution
    const repo = dataset as DocumentChunkDataset;

    // Determine query vector
    let queryVectors: TypedArray[];

    if (
      typeof query === "string" ||
      (Array.isArray(query) && query.every((q) => typeof q === "string"))
    ) {
      // If query is a string or array of strings, model must be provided (enforced by schema)
      if (!model) {
        throw new Error(
          "Model is required when query is a string. Please provide a model with format 'model:TextEmbeddingTask'."
        );
      }
      const embeddingTask = context.own(new TextEmbeddingTask({ text: query, model }));
      const embeddingResult = await embeddingTask.run();
      queryVectors = Array.isArray(embeddingResult.vector)
        ? embeddingResult.vector
        : [embeddingResult.vector];
    } else if (isTypedArray(query) || (Array.isArray(query) && query.every(isTypedArray))) {
      // Query is already a vector
      queryVectors = Array.isArray(query) ? query : [query];
    } else {
      throw new Error("Query must be a string, array of strings, or TypedArray");
    }

    // Convert to Float32Array for repository search (TODO: Check if repo expects Float32Array by default)
    const searchVectors = queryVectors.map((v) =>
      v instanceof Float32Array ? v : new Float32Array(v)
    );

    const results: Array<DocumentChunk & { score: number }> = [];
    for (const searchVector of searchVectors) {
      const res = await repo.similaritySearch(searchVector, {
        topK,
        filter,
        scoreThreshold,
      });
      results.push(...res);
    }

    // Extract text chunks from metadata
    // Assumes metadata has a 'text' or 'content' field
    const chunks = results.map((r) => {
      const meta = r.metadata as any;
      return meta.text || meta.content || meta.chunk || JSON.stringify(meta);
    });

    const output: ChunkRetrievalTaskOutput = {
      chunks,
      chunk_ids: results.map((r) => r.chunk_id),
      metadata: results.map((r) => r.metadata),
      scores: results.map((r) => r.score),
      count: results.length,
    };

    if (returnVectors) {
      output.vectors = results.map((r) => r.vector);
    }

    return output;
  }
}

export const chunkRetrieval = (input: ChunkRetrievalTaskInput, config?: JobQueueTaskConfig) => {
  return new ChunkRetrievalTask({} as ChunkRetrievalTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    chunkRetrieval: CreateWorkflow<
      ChunkRetrievalTaskInput,
      ChunkRetrievalTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.chunkRetrieval = CreateWorkflow(ChunkRetrievalTask);
