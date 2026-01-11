/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite } from "@workglow/sqlite";
import type { TypedArray } from "@workglow/util";
import { cosineSimilarity } from "@workglow/util";
import { SqliteTabularRepository } from "../tabular/SqliteTabularRepository";
import {
  DocumentNodeVector,
  DocumentNodeVectorKey,
  DocumentNodeVectorSchema,
} from "./DocumentNodeVectorSchema";
import type {
  HybridSearchOptions,
  IDocumentNodeVectorRepository,
  VectorSearchOptions,
} from "./IDocumentNodeVectorRepository";

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
 * SQLite document chunk vector repository implementation using tabular storage underneath.
 * Stores vectors as JSON-encoded arrays with metadata.
 *
 * @template Metadata - The metadata type for the document chunk
 * @template Vector - The vector type for the document chunk
 */
export class SqliteDocumentNodeVectorRepository<
  Metadata extends Record<string, unknown> = Record<string, unknown>,
  Vector extends TypedArray = Float32Array,
>
  extends SqliteTabularRepository<
    typeof DocumentNodeVectorSchema,
    typeof DocumentNodeVectorKey,
    DocumentNodeVector<Metadata, Vector>
  >
  implements
    IDocumentNodeVectorRepository<
      typeof DocumentNodeVectorSchema,
      typeof DocumentNodeVectorKey,
      DocumentNodeVector<Metadata, Vector>
    >
{
  private vectorDimensions: number;
  private VectorType: new (array: number[]) => TypedArray;

  /**
   * Creates a new SQLite document chunk vector repository
   * @param dbOrPath - Either a Database instance or a path to the SQLite database file
   * @param table - The name of the table to use for storage (defaults to 'vectors')
   * @param dimensions - The number of dimensions of the vector
   * @param VectorType - The type of vector to use (defaults to Float32Array)
   */
  constructor(
    dbOrPath: string | Sqlite.Database,
    table: string = "vectors",
    dimensions: number,
    VectorType: new (array: number[]) => TypedArray = Float32Array
  ) {
    super(dbOrPath, table, DocumentNodeVectorSchema, DocumentNodeVectorKey);

    this.vectorDimensions = dimensions;
    this.VectorType = VectorType;
  }

  getVectorDimensions(): number {
    return this.vectorDimensions;
  }

  /**
   * Deserialize vector from JSON string
   * Defaults to Float32Array for compatibility with typical embedding vectors
   */
  private deserializeVector(vectorJson: string): TypedArray {
    const array = JSON.parse(vectorJson);
    // Default to Float32Array for typical use case (embeddings)
    return new this.VectorType(array);
  }

  async similaritySearch(query: TypedArray, options: VectorSearchOptions<Metadata> = {}) {
    const { topK = 10, filter, scoreThreshold = 0 } = options;
    const results: Array<DocumentNodeVector<Metadata, Vector> & { score: number }> = [];

    const allEntities = (await this.getAll()) || [];

    for (const entity of allEntities) {
      // SQLite stores vectors as JSON strings, need to deserialize
      const vectorRaw = entity.vector as unknown as string;
      const vector = this.deserializeVector(vectorRaw);
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
      } as any);
    }

    // Sort by score descending and take top K
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    return topResults;
  }

  async hybridSearch(query: TypedArray, options: HybridSearchOptions<Metadata>) {
    const { topK = 10, filter, scoreThreshold = 0, textQuery, vectorWeight = 0.7 } = options;

    if (!textQuery || textQuery.trim().length === 0) {
      // Fall back to regular vector search if no text query
      return this.similaritySearch(query, { topK, filter, scoreThreshold });
    }

    const results: Array<DocumentNodeVector<Metadata, Vector> & { score: number }> = [];
    const allEntities = (await this.getAll()) || [];
    const queryLower = textQuery.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);

    for (const entity of allEntities) {
      // SQLite stores vectors as JSON strings, need to deserialize
      const vectorRaw = entity.vector as unknown as string;
      const vector =
        typeof vectorRaw === "string"
          ? this.deserializeVector(vectorRaw)
          : (vectorRaw as TypedArray);
      const metadata = entity.metadata;

      // Apply filter if provided
      if (filter && !matchesFilter(metadata, filter)) {
        continue;
      }

      // Calculate vector similarity
      const vectorScore = cosineSimilarity(query, vector);

      // Calculate text relevance (simple keyword matching)
      const metadataText = JSON.stringify(metadata).toLowerCase();
      let textScore = 0;
      if (queryWords.length > 0) {
        let matches = 0;
        for (const word of queryWords) {
          if (metadataText.includes(word)) {
            matches++;
          }
        }
        textScore = matches / queryWords.length;
      }

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
      } as any);
    }

    // Sort by combined score descending and take top K
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    return topResults;
  }
}
