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
import { DataPortSchema, FromSchema } from "@workglow/util";
import { TextClassificationTask } from "./TextClassificationTask";

const inputSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      title: "Query",
      description: "The query to rerank results against",
    },
    chunks: {
      type: "array",
      items: { type: "string" },
      title: "Text Chunks",
      description: "Retrieved text chunks to rerank",
    },
    scores: {
      type: "array",
      items: { type: "number" },
      title: "Initial Scores",
      description: "Initial retrieval scores (optional)",
    },
    metadata: {
      type: "array",
      items: {
        type: "object",
        title: "Metadata",
        description: "Metadata for each chunk",
      },
      title: "Metadata",
      description: "Metadata for each chunk (optional)",
    },
    topK: {
      type: "number",
      title: "Top K",
      description: "Number of top results to return after reranking",
      minimum: 1,
    },
    method: {
      type: "string",
      enum: ["cross-encoder", "reciprocal-rank-fusion", "simple"],
      title: "Reranking Method",
      description: "Method to use for reranking",
      default: "simple",
    },
    model: {
      type: "string",
      title: "Reranker Model",
      description: "Cross-encoder model to use for reranking",
    },
  },
  required: ["query", "chunks"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    chunks: {
      type: "array",
      items: { type: "string" },
      title: "Reranked Chunks",
      description: "Chunks reordered by relevance",
    },
    scores: {
      type: "array",
      items: { type: "number" },
      title: "Reranked Scores",
      description: "New relevance scores",
    },
    metadata: {
      type: "array",
      items: {
        type: "object",
        title: "Metadata",
        description: "Metadata for each chunk",
      },
      title: "Metadata",
      description: "Metadata for reranked chunks",
    },
    originalIndices: {
      type: "array",
      items: { type: "number" },
      title: "Original Indices",
      description: "Original indices of reranked chunks",
    },
    count: {
      type: "number",
      title: "Count",
      description: "Number of results returned",
    },
  },
  required: ["chunks", "scores", "originalIndices", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type RerankerTaskInput = FromSchema<typeof inputSchema>;
export type RerankerTaskOutput = FromSchema<typeof outputSchema>;

interface RankedItem {
  chunk: string;
  score: number;
  metadata?: any;
  originalIndex: number;
}

/**
 * Task for reranking retrieved chunks to improve relevance.
 * Supports multiple reranking methods including cross-encoder models.
 *
 * Note: Cross-encoder reranking requires a model to be loaded.
 * For now, this implements simple heuristic-based reranking.
 */
export class RerankerTask extends Task<RerankerTaskInput, RerankerTaskOutput, JobQueueTaskConfig> {
  public static type = "RerankerTask";
  public static category = "RAG";
  public static title = "Reranker";
  public static description = "Rerank retrieved chunks to improve relevance";
  public static cacheable = true;
  private resolvedCrossEncoderModel?: string | null;

  public static inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  async execute(input: RerankerTaskInput, context: IExecuteContext): Promise<RerankerTaskOutput> {
    const { query, chunks, scores = [], metadata = [], topK, method = "simple", model } = input;

    let rankedItems: RankedItem[];

    switch (method) {
      case "cross-encoder":
        rankedItems = await this.crossEncoderRerank(
          query,
          chunks,
          scores,
          metadata,
          model,
          context
        );
        break;
      case "reciprocal-rank-fusion":
        rankedItems = this.reciprocalRankFusion(chunks, scores, metadata);
        break;
      case "simple":
      default:
        rankedItems = this.simpleRerank(query, chunks, scores, metadata);
        break;
    }

    // Apply topK if specified
    if (topK && topK < rankedItems.length) {
      rankedItems = rankedItems.slice(0, topK);
    }

    return {
      chunks: rankedItems.map((item) => item.chunk),
      scores: rankedItems.map((item) => item.score),
      metadata: rankedItems.map((item) => item.metadata),
      originalIndices: rankedItems.map((item) => item.originalIndex),
      count: rankedItems.length,
    };
  }

  private async crossEncoderRerank(
    query: string,
    chunks: string[],
    scores: number[],
    metadata: any[],
    model: string | undefined,
    context: IExecuteContext
  ): Promise<RankedItem[]> {
    if (chunks.length === 0) {
      return [];
    }

    if (!model) {
      throw new Error(
        "No cross-encoder model found. Please provide a model or register a TextClassificationTask model."
      );
    }

    const items = await Promise.all(
      chunks.map(async (chunk, index) => {
        const pairText = `${query} [SEP] ${chunk}`;
        const task = context.own(
          new TextClassificationTask({ text: pairText, model: model, maxCategories: 2 })
        );
        const result = await task.run();
        const crossScore = this.extractCrossEncoderScore(result.categories);
        return {
          chunk,
          score: Number.isFinite(crossScore) ? crossScore : scores[index] || 0,
          metadata: metadata[index],
          originalIndex: index,
        };
      })
    );

    items.sort((a, b) => b.score - a.score);
    return items;
  }

  private extractCrossEncoderScore(
    categories: Array<{ label: string; score: number }> | undefined
  ): number {
    if (!categories || categories.length === 0) {
      return 0;
    }
    const preferred = categories.find((category) =>
      /^(label_1|positive|relevant|yes|true)$/i.test(category.label)
    );
    if (preferred) {
      return preferred.score;
    }
    let best = categories[0].score;
    for (let i = 1; i < categories.length; i++) {
      if (categories[i].score > best) {
        best = categories[i].score;
      }
    }
    return best;
  }

  /**
   * Simple heuristic-based reranking using keyword matching and position
   */
  private simpleRerank(
    query: string,
    chunks: string[],
    scores: number[],
    metadata: any[]
  ): RankedItem[] {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);

    const items: RankedItem[] = chunks.map((chunk, index) => {
      const chunkLower = chunk.toLowerCase();
      const initialScore = scores[index] || 0;

      // Calculate keyword match score
      let keywordScore = 0;
      let exactMatchBonus = 0;

      for (const word of queryWords) {
        // Count occurrences
        const regex = new RegExp(word, "gi");
        const matches = chunkLower.match(regex);
        if (matches) {
          keywordScore += matches.length;
        }
      }

      // Bonus for exact query match
      if (chunkLower.includes(queryLower)) {
        exactMatchBonus = 0.5;
      }

      // Normalize keyword score
      const normalizedKeywordScore = Math.min(keywordScore / (queryWords.length * 3), 1);

      // Position penalty (prefer earlier results, but not too heavily)
      const positionPenalty = Math.log(index + 1) / 10;

      // Combined score
      const combinedScore =
        initialScore * 0.4 + normalizedKeywordScore * 0.4 + exactMatchBonus * 0.2 - positionPenalty;

      return {
        chunk,
        score: combinedScore,
        metadata: metadata[index],
        originalIndex: index,
      };
    });

    // Sort by score descending
    items.sort((a, b) => b.score - a.score);

    return items;
  }

  /**
   * Reciprocal Rank Fusion for combining multiple rankings
   * Useful when you have multiple retrieval methods
   */
  private reciprocalRankFusion(chunks: string[], scores: number[], metadata: any[]): RankedItem[] {
    const k = 60; // RRF constant

    const items: RankedItem[] = chunks.map((chunk, index) => {
      // RRF score = 1 / (k + rank)
      // Here we use the initial ranking (index) as the rank
      const rrfScore = 1 / (k + index + 1);

      return {
        chunk,
        score: rrfScore,
        metadata: metadata[index],
        originalIndex: index,
      };
    });

    // Sort by RRF score descending
    items.sort((a, b) => b.score - a.score);

    return items;
  }
}


export const reranker = (input: RerankerTaskInput, config?: JobQueueTaskConfig) => {
  return new RerankerTask({} as RerankerTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    reranker: CreateWorkflow<RerankerTaskInput, RerankerTaskOutput, JobQueueTaskConfig>;
  }
}

Workflow.prototype.reranker = CreateWorkflow(RerankerTask);
