/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DataPortSchemaObject,
  FromSchema,
  TypedArray,
  TypedArrayConstructor,
  TypedArraySchemaOptions,
} from "@workglow/util/schema";
import { cosineSimilarity } from "@workglow/util/schema";
import { InMemoryTabularStorage } from "../tabular/InMemoryTabularStorage";
import type { HybridSearchOptions, IVectorStorage, VectorSearchOptions } from "./IVectorStorage";
import { getMetadataProperty, getVectorProperty } from "./IVectorStorage";

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
 * Extends InMemoryTabularStorage for storage.
 * Suitable for testing and small-scale browser applications.
 * Supports all vector types including quantized formats.
 *
 * @template Metadata - The metadata type for the document chunk
 * @template VectorCtor - Constructor for stored vectors (default {@link typeof Float32Array})
 */
export class InMemoryVectorStorage<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
  VectorCtor extends TypedArrayConstructor = typeof Float32Array,
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
>
  extends InMemoryTabularStorage<Schema, PrimaryKeyNames, Entity>
  implements IVectorStorage<Metadata, Schema, Entity, PrimaryKeyNames>
{
  private vectorDimensions: number;
  private vectorPropertyName: keyof Entity;
  private metadataPropertyName: keyof Entity | undefined;

  /**
   * Creates a new in-memory document chunk vector repository
   * @param schema - The schema definition for the entity
   * @param primaryKeyNames - Array of property names that form the primary key
   * @param indexes - Array of columns or column arrays to make searchable
   * @param dimensions - The number of dimensions of the vector
   * @param vectorCtor - TypedArray constructor
   */
  constructor(
    schema: Schema,
    primaryKeyNames: PrimaryKeyNames,
    indexes: readonly (keyof Entity | readonly (keyof Entity)[])[] = [],
    dimensions: number,
    _vectorCtor: VectorCtor = Float32Array as VectorCtor
  ) {
    super(schema, primaryKeyNames, indexes);

    this.vectorDimensions = dimensions;

    // Cache vector and metadata property names from schema
    const vectorProp = getVectorProperty(schema);
    if (!vectorProp) {
      throw new Error("Schema must have a property with type array and format TypedArray");
    }
    this.vectorPropertyName = vectorProp as keyof Entity;
    this.metadataPropertyName = getMetadataProperty(schema) as keyof Entity | undefined;
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
    const results: Array<Entity & { score: number }> = [];

    const allEntities = (await this.getAll()) || [];

    for (const entity of allEntities) {
      const vector = entity[this.vectorPropertyName] as TypedArray;
      const metadata = this.metadataPropertyName
        ? (entity[this.metadataPropertyName] as Metadata)
        : ({} as Metadata);

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
        score,
      } as Entity & { score: number });
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

    const results: Array<Entity & { score: number }> = [];
    const allEntities = (await this.getAll()) || [];

    for (const entity of allEntities) {
      // In memory, vectors are stored as TypedArrays directly (not serialized)
      const vector = entity[this.vectorPropertyName] as TypedArray;
      const metadata = this.metadataPropertyName
        ? (entity[this.metadataPropertyName] as Metadata)
        : ({} as Metadata);

      // Apply filter if provided
      if (filter && !matchesFilter(metadata, filter)) {
        continue;
      }

      // Calculate vector similarity
      const vectorScore = cosineSimilarity(query, vector);

      // Calculate text relevance (simple keyword matching)
      const metadataText = Object.values(metadata ?? {})
        .join(" ")
        .toLowerCase();
      const textScore = textRelevance(metadataText, textQuery);

      // Combine scores
      const combinedScore = vectorWeight * vectorScore + (1 - vectorWeight) * textScore;

      // Apply threshold
      if (combinedScore < scoreThreshold) {
        continue;
      }

      results.push({
        ...entity,
        score: combinedScore,
      } as Entity & { score: number });
    }

    // Sort by combined score descending and take top K
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    return topResults;
  }
}
