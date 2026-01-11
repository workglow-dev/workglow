/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AnyDocumentChunkVectorRepository,
  TypeDocumentChunkVectorRepository,
} from "@workglow/storage";
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
    repository: TypeDocumentChunkVectorRepository({
      title: "Vector Repository",
      description: "The vector repository instance to search in",
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
  required: ["repository", "query"],
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

/**
 * Task for searching similar vectors in a vector repository.
 * Returns top-K most similar vectors with their metadata and scores.
 */
export class DocumentChunkVectorSearchTask extends Task<
  VectorStoreSearchTaskInput,
  VectorStoreSearchTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "DocumentChunkVectorSearchTask";
  public static category = "Vector Store";
  public static title = "Vector Store Search";
  public static description = "Search for similar vectors in a vector repository";
  public static cacheable = true;

  public static inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  async execute(
    input: VectorStoreSearchTaskInput,
    context: IExecuteContext
  ): Promise<VectorStoreSearchTaskOutput> {
    const { repository, query, topK = 10, filter, scoreThreshold = 0 } = input;

    const repo = repository as AnyDocumentChunkVectorRepository;

    const results = await repo.similaritySearch(query, {
      topK,
      filter,
      scoreThreshold,
    });

    return {
      ids: results.map((r) => r.id),
      vectors: results.map((r) => r.vector),
      metadata: results.map((r) => r.metadata),
      scores: results.map((r) => r.score),
      count: results.length,
    };
  }
}

TaskRegistry.registerTask(DocumentChunkVectorSearchTask);

export const vectorStoreSearch = (
  input: VectorStoreSearchTaskInput,
  config?: JobQueueTaskConfig
) => {
  return new DocumentChunkVectorSearchTask({} as VectorStoreSearchTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    vectorStoreSearch: CreateWorkflow<
      VectorStoreSearchTaskInput,
      VectorStoreSearchTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.vectorStoreSearch = CreateWorkflow(DocumentChunkVectorSearchTask);
