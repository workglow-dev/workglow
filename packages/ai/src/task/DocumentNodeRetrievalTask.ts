/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AnyDocumentNodeVectorRepository,
  TypeDocumentNodeVectorRepository,
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
  TypedArray,
  TypedArraySchema,
  TypedArraySchemaOptions,
} from "@workglow/util";
import { TypeModel } from "./base/AiTaskSchemas";
import { TextEmbeddingTask } from "./TextEmbeddingTask";

const inputSchema = {
  type: "object",
  properties: {
    repository: TypeDocumentNodeVectorRepository({
      title: "Document Chunk Vector Repository",
      description: "The document chunk vector repository instance to search in",
    }),
    query: {
      oneOf: [
        { type: "string" },
        TypedArraySchema({
          title: "Query Vector",
          description: "Pre-computed query vector",
        }),
      ],
      title: "Query",
      description: "Query string or pre-computed query vector",
    },
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
  required: ["repository", "query"],
  if: {
    properties: {
      query: { type: "string" },
    },
  },
  then: {
    required: ["repository", "query", "model"],
  },
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
  required: ["chunks", "ids", "metadata", "scores", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type RetrievalTaskInput = FromSchema<typeof inputSchema, TypedArraySchemaOptions>;
export type RetrievalTaskOutput = FromSchema<typeof outputSchema, TypedArraySchemaOptions>;

/**
 * End-to-end retrieval task that combines embedding generation (if needed) and vector search.
 * Simplifies the RAG pipeline by handling the full retrieval process.
 */
export class DocumentNodeRetrievalTask extends Task<
  RetrievalTaskInput,
  RetrievalTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "DocumentNodeRetrievalTask";
  public static category = "RAG";
  public static title = "Retrieval";
  public static description = "End-to-end retrieval: embed query and search for similar chunks";
  public static cacheable = true;

  public static inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  async execute(input: RetrievalTaskInput, context: IExecuteContext): Promise<RetrievalTaskOutput> {
    const {
      repository,
      query,
      topK = 5,
      filter,
      model,
      scoreThreshold = 0,
      returnVectors = false,
    } = input;

    // Repository is resolved by input resolver system before execution
    const repo = repository as AnyDocumentNodeVectorRepository;

    // Determine query vector
    let queryVector: TypedArray;
    if (typeof query === "string") {
      // If query is a string, model must be provided (enforced by schema)
      if (!model) {
        throw new Error(
          "Model is required when query is a string. Please provide a model with format 'model:TextEmbeddingTask'."
        );
      }
      const embeddingTask = context.own(new TextEmbeddingTask({ text: query, model }));
      const embeddingResult = await embeddingTask.run();
      queryVector = Array.isArray(embeddingResult.vector)
        ? embeddingResult.vector[0]
        : embeddingResult.vector;
    } else {
      // Query is already a vector
      queryVector = query as TypedArray;
    }

    // Convert to Float32Array for repository search (repo expects Float32Array by default)
    const searchVector =
      queryVector instanceof Float32Array ? queryVector : new Float32Array(queryVector);

    // Search vector repository
    const results = await repo.similaritySearch(searchVector, {
      topK,
      filter,
      scoreThreshold,
    });

    // Extract text chunks from metadata
    // Assumes metadata has a 'text' or 'content' field
    const chunks = results.map((r) => {
      const meta = r.metadata as any;
      return meta.text || meta.content || meta.chunk || JSON.stringify(meta);
    });

    const output: RetrievalTaskOutput = {
      chunks,
      ids: results.map((r) => r.chunk_id),
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


export const retrieval = (input: RetrievalTaskInput, config?: JobQueueTaskConfig) => {
  return new DocumentNodeRetrievalTask({} as RetrievalTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    retrieval: CreateWorkflow<RetrievalTaskInput, RetrievalTaskOutput, JobQueueTaskConfig>;
  }
}

Workflow.prototype.retrieval = CreateWorkflow(DocumentNodeRetrievalTask);
