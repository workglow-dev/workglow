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

const inputSchema = {
  type: "object",
  properties: {
    repository: TypeVectorRepository({
      title: "Vector Repository",
      description: "The vector repository instance to search in (must support hybridSearch)",
    }),
    queryVector: TypedArraySchema({
      title: "Query Vector",
      description: "The query vector for semantic search",
    }),
    queryText: {
      type: "string",
      title: "Query Text",
      description: "The query text for full-text search",
    },
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
      description: "Minimum combined score threshold (0-1)",
      minimum: 0,
      maximum: 1,
      default: 0,
    },
    vectorWeight: {
      type: "number",
      title: "Vector Weight",
      description: "Weight for vector similarity (0-1), remainder goes to text relevance",
      minimum: 0,
      maximum: 1,
      default: 0.7,
    },
    returnVectors: {
      type: "boolean",
      title: "Return Vectors",
      description: "Whether to return vector embeddings in results",
      default: false,
    },
  },
  required: ["repository", "queryVector", "queryText"],
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
    ids: {
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
      description: "Combined relevance scores for each result",
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
  required: ["chunks", "ids", "metadata", "scores", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type HybridSearchTaskInput = FromSchema<typeof inputSchema, TypedArraySchemaOptions>;
export type HybridSearchTaskOutput = FromSchema<typeof outputSchema, TypedArraySchemaOptions>;

/**
 * Task for hybrid search combining vector similarity and full-text search.
 * Requires a vector repository that supports hybridSearch (e.g., SeekDB, Postgres with pgvector).
 *
 * Hybrid search improves retrieval by combining:
 * - Semantic similarity (vector search) - understands meaning
 * - Keyword matching (full-text search) - finds exact terms
 */
export class HybridSearchTask extends Task<
  HybridSearchTaskInput,
  HybridSearchTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "HybridSearchTask";
  public static category = "RAG";
  public static title = "Hybrid Search";
  public static description = "Combined vector + full-text search for improved retrieval";
  public static cacheable = true;

  public static inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  async execute(
    input: HybridSearchTaskInput,
    context: IExecuteContext
  ): Promise<HybridSearchTaskOutput> {
    const {
      repository,
      queryVector,
      queryText,
      topK = 10,
      filter,
      scoreThreshold = 0,
      vectorWeight = 0.7,
      returnVectors = false,
    } = input;

    // Repository is resolved by input resolver system before execution
    const repo = repository as AnyVectorRepository;

    // Check if repository supports hybrid search
    if (!repo.hybridSearch) {
      throw new Error(
        "Repository does not support hybrid search. Use SeekDbVectorRepository or PostgresVectorRepository."
      );
    }

    // Convert to Float32Array for repository search (repo expects Float32Array by default)
    const searchVector =
      queryVector instanceof Float32Array ? queryVector : new Float32Array(queryVector);

    // Perform hybrid search
    const results = await repo.hybridSearch(searchVector, {
      textQuery: queryText,
      topK,
      filter,
      scoreThreshold,
      vectorWeight,
    });

    // Extract text chunks from metadata
    const chunks = results.map((r) => {
      const meta = r.metadata as Record<string, string>;
      return meta.text || meta.content || meta.chunk || JSON.stringify(meta);
    });

    const output: HybridSearchTaskOutput = {
      chunks,
      ids: results.map((r) => r.id),
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

TaskRegistry.registerTask(HybridSearchTask);

export const hybridSearch = async (
  input: HybridSearchTaskInput,
  config?: JobQueueTaskConfig
): Promise<HybridSearchTaskOutput> => {
  return new HybridSearchTask({} as HybridSearchTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    hybridSearch: CreateWorkflow<HybridSearchTaskInput, HybridSearchTaskOutput, JobQueueTaskConfig>;
  }
}

Workflow.prototype.hybridSearch = CreateWorkflow(HybridSearchTask);
