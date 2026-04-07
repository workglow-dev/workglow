/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { KnowledgeBase, TypeKnowledgeBase } from "@workglow/knowledge-base";
import {
  CreateWorkflow,
  IExecuteContext,
  type TaskConfig,
  Task,
  Workflow,
} from "@workglow/task-graph";
import {
  DataPortSchema,
  FromSchema,
  TypedArraySchema,
  TypedArraySchemaOptions,
} from "@workglow/util/schema";

const inputSchema = {
  type: "object",
  properties: {
    knowledgeBase: TypeKnowledgeBase({
      title: "Knowledge Base",
      description: "The knowledge base instance to search in",
    }),
    query: TypedArraySchema({
      title: "Query Vector",
      description: "The query vector to search for similar vectors",
    }),
    topK: {
      type: "number",
      title: "Top K",
      description: "Number of top results to return",
      minimum: 1,
      default: 10,
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
  },
  required: ["knowledgeBase", "query"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    ids: {
      type: "array",
      items: { type: "string" },
      title: "IDs",
      description: "IDs of matching vectors",
    },
    vectors: {
      type: "array",
      items: TypedArraySchema({
        title: "Vector",
        description: "Matching vector embedding",
      }),
      title: "Vectors",
      description: "Matching vector embeddings",
    },
    metadata: {
      type: "array",
      items: {
        type: "object",
        title: "Metadata",
        description: "Metadata of matching vector",
      },
      title: "Metadata",
      description: "Metadata of matching vectors",
    },
    scores: {
      type: "array",
      items: { type: "number" },
      title: "Scores",
      description: "Similarity scores for each result",
    },
    count: {
      type: "number",
      title: "Count",
      description: "Number of results returned",
    },
  },
  required: ["ids", "vectors", "metadata", "scores", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type VectorStoreSearchTaskInput = FromSchema<typeof inputSchema, TypedArraySchemaOptions>;
export type VectorStoreSearchTaskOutput = FromSchema<typeof outputSchema, TypedArraySchemaOptions>;
export type ChunkVectorSearchTaskConfig = TaskConfig<VectorStoreSearchTaskInput>;

/**
 * Task for searching similar vectors in a knowledge base.
 * Returns top-K most similar vectors with their metadata and scores.
 */
export class ChunkVectorSearchTask extends Task<
  VectorStoreSearchTaskInput,
  VectorStoreSearchTaskOutput,
  ChunkVectorSearchTaskConfig
> {
  public static override type = "ChunkVectorSearchTask";
  public static override category = "Vector Store";
  public static override title = "Vector Store Search";
  public static override description = "Search for similar vectors in a knowledge base";
  public static override cacheable = true;

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: VectorStoreSearchTaskInput,
    _context: IExecuteContext
  ): Promise<VectorStoreSearchTaskOutput> {
    const { knowledgeBase, query, topK = 10, filter, scoreThreshold = 0 } = input;

    const kb = knowledgeBase as KnowledgeBase;

    const results = await kb.similaritySearch(query, {
      topK,
      filter,
      scoreThreshold,
    });

    return {
      ids: results.map((r) => r.chunk_id),
      vectors: results.map((r) => r.vector),
      metadata: results.map((r) => r.metadata),
      scores: results.map((r) => r.score),
      count: results.length,
    };
  }
}

export const vectorStoreSearch = (
  input: VectorStoreSearchTaskInput,
  config?: ChunkVectorSearchTaskConfig
) => {
  return new ChunkVectorSearchTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    vectorStoreSearch: CreateWorkflow<
      VectorStoreSearchTaskInput,
      VectorStoreSearchTaskOutput,
      ChunkVectorSearchTaskConfig
    >;
  }
}

Workflow.prototype.vectorStoreSearch = CreateWorkflow(ChunkVectorSearchTask);
