/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { cosineSimilarity, EventEmitter, TypedArray } from "@workglow/util";
import { InMemoryTabularRepository } from "../tabular/InMemoryTabularRepository";
import {
  HybridSearchOptions,
  IVectorRepository,
  SearchResult,
  VectorEntry,
  VectorEventListeners,
  VectorSchema,
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
 * Uses InMemoryTabularRepository internally for storage.
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
  private tabularRepo: InMemoryTabularRepository<typeof VectorSchema, ["id"]>;

  /**
   * Creates a new in-memory vector repository
   */
  constructor() {
    super();
    this.tabularRepo = new InMemoryTabularRepository(VectorSchema, ["id"] as const, []);
  }

  async setupDatabase(): Promise<void> {
    await this.tabularRepo.setupDatabase();
  }

  async upsert(id: string, vector: VectorChoice, metadata: Metadata): Promise<void> {
    const entity = {
      id,
      vector: vector as any, // Store TypedArray directly in memory
      metadata: JSON.stringify(metadata),
    };
    await this.tabularRepo.put(entity);
    this.emit("upsert", { id, vector, metadata });
  }

  async upsertBulk(items: VectorEntry<Metadata, VectorChoice>[]): Promise<void> {
    const entities = items.map((item) => ({
      id: item.id,
      vector: item.vector as any,
      metadata: JSON.stringify(item.metadata),
    }));
    await this.tabularRepo.putBulk(entities);
    for (const item of items) {
      this.emit("upsert", item);
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

  async similaritySearch(
    query: VectorChoice,
    options: VectorSearchOptions<Metadata, VectorChoice> = {}
  ): Promise<SearchResult<Metadata, VectorChoice>[]> {
    const { topK = 10, filter, scoreThreshold = 0 } = options;
    const results: SearchResult<Metadata, VectorChoice>[] = [];

    const allEntities = (await this.tabularRepo.getAll()) || [];

    for (const entity of allEntities) {
      const vector = entity.vector as unknown as VectorChoice;
      const metadata = JSON.parse(entity.metadata) as Metadata;

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
        id: entity.id,
        vector,
        metadata,
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
      return this.similaritySearch(query, { topK, filter, scoreThreshold });
    }

    const results: SearchResult<Metadata, VectorChoice>[] = [];
    const allEntities = (await this.tabularRepo.getAll()) || [];

    for (const entity of allEntities) {
      const vector = entity.vector as unknown as VectorChoice;
      const metadata = JSON.parse(entity.metadata) as Metadata;

      // Apply filter if provided
      if (filter && !matchesFilter(metadata, filter)) {
        continue;
      }

      // Calculate vector similarity
      const vectorScore = cosineSimilarity(query, vector);

      // Calculate text relevance (simple keyword matching)
      const metadataText = entity.metadata.toLowerCase();
      const textScore = textRelevance(metadataText, textQuery);

      // Combine scores
      const combinedScore = vectorWeight * vectorScore + (1 - vectorWeight) * textScore;

      // Apply threshold
      if (combinedScore < scoreThreshold) {
        continue;
      }

      results.push({
        id: entity.id,
        vector,
        metadata,
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
    const entity = await this.tabularRepo.get({ id });
    if (entity) {
      return {
        id: entity.id,
        vector: this.copyVector(entity.vector as unknown as TypedArray),
        metadata: JSON.parse(entity.metadata) as Metadata,
      };
    }
    return undefined;
  }

  async delete(id: string): Promise<void> {
    await this.tabularRepo.delete({ id });
    this.emit("delete", id);
  }

  async deleteBulk(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  async deleteByFilter(filter: Partial<Metadata>): Promise<void> {
    const allEntities = (await this.tabularRepo.getAll()) || [];
    const idsToDelete: string[] = [];

    for (const entity of allEntities) {
      const metadata = JSON.parse(entity.metadata) as Metadata;
      if (matchesFilter(metadata, filter)) {
        idsToDelete.push(entity.id);
      }
    }

    await this.deleteBulk(idsToDelete);
  }

  async size(): Promise<number> {
    return await this.tabularRepo.size();
  }

  async clear(): Promise<void> {
    const allEntities = (await this.tabularRepo.getAll()) || [];
    await this.tabularRepo.deleteAll();
    for (const entity of allEntities) {
      this.emit("delete", entity.id);
    }
  }

  destroy(): void {
    this.tabularRepo.destroy();
    this.removeAllListeners();
  }
}
