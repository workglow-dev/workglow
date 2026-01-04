/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { cosineSimilarity, EventEmitter, TypedArray } from "@workglow/util";
import {
  HybridSearchOptions,
  IVectorRepository,
  SearchResult,
  VectorEntry,
  VectorEventListeners,
  VectorSearchOptions,
} from "./IVectorRepository";

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
 * In-memory vector repository implementation.
 * Suitable for testing and small-scale browser applications.
 * Supports all vector types including quantized formats.
 *
 * @template Metadata - Type for metadata associated with vectors
 * @template VectorChoice - Type of vector array (Float32Array, Int8Array, etc.)
 */
export class InMemoryVectorRepository<
  Metadata = Record<string, unknown>,
  VectorChoice extends TypedArray = Float32Array,
>
  extends EventEmitter<VectorEventListeners<Metadata, VectorChoice>>
  implements IVectorRepository<Metadata, VectorChoice>
{
  private vectors: Map<string, VectorEntry<Metadata, VectorChoice>> = new Map();
  private initialized = false;

  /**
   * Creates a new in-memory vector repository
   */
  constructor() {
    super();
  }

  async setupDatabase(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
  }

  async upsert(id: string, vector: VectorChoice, metadata: Metadata): Promise<void> {
    const entry: VectorEntry<Metadata, VectorChoice> = {
      id,
      vector: this.copyVector(vector),
      metadata: { ...metadata } as Metadata,
    };
    this.vectors.set(id, entry);
    this.emit("upsert", entry);
  }

  async upsertBulk(items: VectorEntry<Metadata, VectorChoice>[]): Promise<void> {
    for (const item of items) {
      const entry: VectorEntry<Metadata, VectorChoice> = {
        id: item.id,
        vector: this.copyVector(item.vector),
        metadata: { ...item.metadata } as Metadata,
      };
      this.vectors.set(item.id, entry);
      this.emit("upsert", entry);
    }
  }

  /**
   * Copy a vector to avoid external mutations
   */
  private copyVector(vector: TypedArray): VectorChoice {
    if (vector instanceof Float32Array) return new Float32Array(vector) as VectorChoice;
    if (vector instanceof Float64Array) return new Float64Array(vector) as VectorChoice;
    if (vector instanceof Int8Array) return new Int8Array(vector) as VectorChoice;
    if (vector instanceof Uint8Array) return new Uint8Array(vector) as VectorChoice;
    if (vector instanceof Int16Array) return new Int16Array(vector) as VectorChoice;
    if (vector instanceof Uint16Array) return new Uint16Array(vector) as VectorChoice;
    return new Float32Array(vector) as VectorChoice;
  }

  async search(
    query: VectorChoice,
    options: VectorSearchOptions<Metadata, VectorChoice> = {}
  ): Promise<SearchResult<Metadata, VectorChoice>[]> {
    const { topK = 10, filter, scoreThreshold = 0 } = options;
    const results: SearchResult<Metadata, VectorChoice>[] = [];

    for (const entry of this.vectors.values()) {
      // Apply filter if provided
      if (filter && !matchesFilter(entry.metadata, filter)) {
        continue;
      }

      // Calculate similarity
      const score = cosineSimilarity(query, entry.vector);

      // Apply threshold
      if (score < scoreThreshold) {
        continue;
      }

      results.push({
        id: entry.id,
        vector: entry.vector,
        metadata: entry.metadata,
        score,
      });
    }

    // Sort by score descending and take top K
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    this.emit("search", query, topResults);
    return topResults;
  }

  async hybridSearch(
    query: VectorChoice,
    options: HybridSearchOptions<Metadata, VectorChoice>
  ): Promise<SearchResult<Metadata, VectorChoice>[]> {
    const { topK = 10, filter, scoreThreshold = 0, textQuery, vectorWeight = 0.7 } = options;

    if (!textQuery || textQuery.trim().length === 0) {
      // Fall back to regular vector search if no text query
      return this.search(query, { topK, filter, scoreThreshold });
    }

    const results: SearchResult<Metadata, VectorChoice>[] = [];

    for (const entry of this.vectors.values()) {
      // Apply filter if provided
      if (filter && !matchesFilter(entry.metadata, filter)) {
        continue;
      }

      // Calculate vector similarity
      const vectorScore = cosineSimilarity(query, entry.vector);

      // Calculate text relevance (simple keyword matching)
      // Try to find text in metadata
      const metadataText = JSON.stringify(entry.metadata).toLowerCase();
      const textScore = textRelevance(metadataText, textQuery);

      // Combine scores
      const combinedScore = vectorWeight * vectorScore + (1 - vectorWeight) * textScore;

      // Apply threshold
      if (combinedScore < scoreThreshold) {
        continue;
      }

      results.push({
        id: entry.id,
        vector: entry.vector,
        metadata: entry.metadata,
        score: combinedScore,
      });
    }

    // Sort by combined score descending and take top K
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    this.emit("search", query, topResults);
    return topResults;
  }

  async get(id: string): Promise<VectorEntry<Metadata, VectorChoice> | undefined> {
    const entry = this.vectors.get(id);
    if (entry) {
      return {
        id: entry.id,
        vector: this.copyVector(entry.vector),
        metadata: { ...entry.metadata } as Metadata,
      };
    }
    return undefined;
  }

  async delete(id: string): Promise<void> {
    if (this.vectors.has(id)) {
      this.vectors.delete(id);
      this.emit("delete", id);
    }
  }

  async deleteBulk(ids: string[]): Promise<void> {
    for (const id of ids) {
      if (this.vectors.has(id)) {
        this.vectors.delete(id);
        this.emit("delete", id);
      }
    }
  }

  async deleteByFilter(filter: Partial<Metadata>): Promise<void> {
    const idsToDelete: string[] = [];
    for (const entry of this.vectors.values()) {
      if (matchesFilter(entry.metadata, filter)) {
        idsToDelete.push(entry.id);
      }
    }
    await this.deleteBulk(idsToDelete);
  }

  async size(): Promise<number> {
    return this.vectors.size;
  }

  async clear(): Promise<void> {
    const ids = Array.from(this.vectors.keys());
    this.vectors.clear();
    for (const id of ids) {
      this.emit("delete", id);
    }
  }

  destroy(): void {
    this.vectors.clear();
    this.removeAllListeners();
  }
}
