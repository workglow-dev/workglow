/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TypedArray } from "@workglow/util";
import { cosineSimilarity } from "@workglow/util";
import { InMemoryTabularRepository } from "../tabular/InMemoryTabularRepository";
import {
  DocumentChunkVector,
  DocumentChunkVectorKey,
  DocumentChunkVectorSchema,
} from "./DocumentChunkVectorSchema";
import type {
  HybridSearchOptions,
  IDocumentChunkVectorRepository,
  VectorSearchOptions,
} from "./IDocumentChunkVectorRepository";

/**
 * Check if metadata matches filter
 */
function matchesFilter<Metadata>(metadata: Metadata, filter: Partial<Metadata>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key as keyof Metadata] !== value) {
      return false;
    }
  }
  return true;
}

/**
 * Simple full-text search scoring (keyword matching)
 */
function textRelevance(text: string, query: string): number {
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);
  if (queryWords.length === 0) {
    return 0;
  }
  let matches = 0;
  for (const word of queryWords) {
    if (textLower.includes(word)) {
      matches++;
    }
  }
  return matches / queryWords.length;
}

/**
 * In-memory document chunk vector repository implementation.
 * Extends InMemoryTabularRepository for storage.
 * Suitable for testing and small-scale browser applications.
 * Supports all vector types including quantized formats.
 *
 * @template Metadata - The metadata type for the document chunk
 * @template Vector - The vector type for the document chunk
 */
export class InMemoryDocumentChunkVectorRepository<
  Metadata extends Record<string, unknown> = Record<string, unknown>,
  Vector extends TypedArray = Float32Array,
>
  extends InMemoryTabularRepository<
    typeof DocumentChunkVectorSchema,
    typeof DocumentChunkVectorKey,
    DocumentChunkVector<Metadata, Vector>
  >
  implements
    IDocumentChunkVectorRepository<
      typeof DocumentChunkVectorSchema,
      typeof DocumentChunkVectorKey,
      DocumentChunkVector<Metadata, Vector>
    >
{
  private vectorDimensions: number;
  private VectorType: new (array: number[]) => TypedArray;

  /**
   * Creates a new in-memory document chunk vector repository
   * @param dimensions - The number of dimensions of the vector
   * @param VectorType - The type of vector to use (defaults to Float32Array)
   */
  constructor(dimensions: number, VectorType: new (array: number[]) => TypedArray = Float32Array) {
    super(DocumentChunkVectorSchema, DocumentChunkVectorKey);

    this.vectorDimensions = dimensions;
    this.VectorType = VectorType;
  }

  /**
   * Get the vector dimensions
   * @returns The vector dimensions
   */
  getVectorDimensions(): number {
    return this.vectorDimensions;
  }

  async similaritySearch(
    query: TypedArray,
    options: VectorSearchOptions<Record<string, unknown>> = {}
  ) {
    const { topK = 10, filter, scoreThreshold = 0 } = options;
    const results: Array<DocumentChunkVector<Metadata, Vector> & { score: number }> = [];

    const allEntities = (await this.getAll()) || [];

    for (const entity of allEntities) {
      const vector = entity.vector;
      const metadata = entity.metadata;

      // Apply filter if provided
      if (filter && !matchesFilter(metadata, filter)) {
        continue;
      }

      // Calculate similarity
      const score = cosineSimilarity(query, vector);

      // Apply threshold
      if (score < scoreThreshold) {
        continue;
      }

      results.push({
        ...entity,
        vector,
        score,
      });
    }

    // Sort by score descending and take top K
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    return topResults;
  }

  async hybridSearch(query: TypedArray, options: HybridSearchOptions<Record<string, unknown>>) {
    const { topK = 10, filter, scoreThreshold = 0, textQuery, vectorWeight = 0.7 } = options;

    if (!textQuery || textQuery.trim().length === 0) {
      // Fall back to regular vector search if no text query
      return this.similaritySearch(query, { topK, filter, scoreThreshold });
    }

    const results: Array<DocumentChunkVector<Metadata, Vector> & { score: number }> = [];
    const allEntities = (await this.getAll()) || [];

    for (const entity of allEntities) {
      // In memory, vectors are stored as TypedArrays directly (not serialized)
      const vector = entity.vector;
      const metadata = entity.metadata;

      // Apply filter if provided
      if (filter && !matchesFilter(metadata, filter)) {
        continue;
      }

      // Calculate vector similarity
      const vectorScore = cosineSimilarity(query, vector);

      // Calculate text relevance (simple keyword matching)
      const metadataText = Object.values(metadata).join(" ").toLowerCase();
      const textScore = textRelevance(metadataText, textQuery);

      // Combine scores
      const combinedScore = vectorWeight * vectorScore + (1 - vectorWeight) * textScore;

      // Apply threshold
      if (combinedScore < scoreThreshold) {
        continue;
      }

      results.push({
        ...entity,
        vector,
        score: combinedScore,
      });
    }

    // Sort by combined score descending and take top K
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    return topResults;
  }
}
