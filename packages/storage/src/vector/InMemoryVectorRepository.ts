/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject, TypedArray, TypedArraySchemaOptions } from "@workglow/util";
import { cosineSimilarity, FromSchema } from "@workglow/util";
import { InMemoryTabularRepository } from "../tabular/InMemoryTabularRepository";
import type {
  HybridSearchOptions,
  IVectorRepository,
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
 * Extends InMemoryTabularRepository for storage.
 * Suitable for testing and small-scale browser applications.
 * Supports all vector types including quantized formats.
 *
 * Supports custom schemas for flexibility (e.g., multi-tenant with additional columns).
 * The schema must have at least one column with { type: "string", format: "TypedArray", x-dimensions: number }
 *
 * @template Schema - The schema definition for the entity using JSON Schema
 * @template PrimaryKeyNames - Array of property names that form the primary key
 * @template Entity - The entity type
 */
export class InMemoryVectorRepository<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
>
  extends InMemoryTabularRepository<Schema, PrimaryKeyNames, Entity>
  implements IVectorRepository<Schema, PrimaryKeyNames, Entity>
{
  private vectorColumn: string;
  private metadataColumn: string | undefined;

  /**
   * Creates a new in-memory vector repository
   * @param schema - Schema with at least one vector column (format: "TypedArray", x-dimensions: number)
   * @param primaryKeyNames - Array of property names that form the primary key (e.g., ["id"] or ["tenantId", "id"])
   * @param indexes - Array of columns or column arrays to make searchable (e.g., [["tenantId"], ["docId"]])
   */
  constructor(
    schema: Schema,
    primaryKeyNames: PrimaryKeyNames,
    indexes: readonly (keyof Entity | readonly (keyof Entity)[])[] = []
  ) {
    super(schema, primaryKeyNames, indexes);

    // Find the vector column from the schema
    const vectorColumns = this.findVectorColumns(schema);
    if (vectorColumns.length === 0) {
      throw new Error(
        `Schema must have at least one property with format: "TypedArray" and dimension specified`
      );
    }
    // Use the first vector column (support for multiple vectors can be added later)
    this.vectorColumn = vectorColumns[0].column;

    // Find the metadata column from the schema
    const metadataColumn = this.findMetadataColumn(schema);
    if (!metadataColumn) {
      throw new Error(`Schema must have at least one property with format: "metadata"`);
    }
    this.metadataColumn = metadataColumn;
  }

  /**
   * Finds all vector columns in the schema
   */
  private findVectorColumns(schema: Schema): Array<{ column: string; dimension: number }> {
    const vectorColumns: Array<{ column: string; dimension: number }> = [];

    for (const [key, typeDef] of Object.entries(schema.properties)) {
      if (
        (typeDef as { format?: string }).format === "vector" &&
        typeof (typeDef as { dimension?: number }).dimension === "number"
      ) {
        vectorColumns.push({
          column: key,
          dimension: (typeDef as { "x-dimensions": number })["x-dimensions"],
        });
      }
    }

    return vectorColumns;
  }

  /**
   * Finds the metadata column in the schema
   */
  private findMetadataColumn(schema: Schema): string | undefined {
    for (const [key, typeDef] of Object.entries(schema.properties)) {
      if ((typeDef as { format?: string }).format === "metadata") {
        return key;
      }
    }
    return undefined;
  }

  async similaritySearch(
    query: TypedArray,
    options: VectorSearchOptions<Record<string, unknown>> = {}
  ) {
    const { topK = 10, filter, scoreThreshold = 0 } = options;
    const results: Array<Entity & { score: number }> = [];

    const allEntities = (await this.getAll()) || [];

    for (const entity of allEntities) {
      const vector = entity[this.vectorColumn as keyof typeof entity] as TypedArray;
      const metadata = entity[this.metadataColumn as keyof typeof entity] as Record<
        string,
        unknown
      >;

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
    results.sort((a, b) => (b as any).score - (a as any).score);
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
      const vector = entity[this.vectorColumn as keyof typeof entity] as TypedArray;
      const metadata = entity[this.metadataColumn as keyof typeof entity] as Record<
        string,
        unknown
      >;

      // Apply filter if provided
      if (filter && !matchesFilter(metadata, filter)) {
        continue;
      }

      // Calculate vector similarity
      const vectorScore = cosineSimilarity(query, vector);

      // Calculate text relevance (simple keyword matching)
      const metadataText = Object.values(metadata as Record<string, unknown>)
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
        vector,
        score: combinedScore,
      });
    }

    // Sort by combined score descending and take top K
    results.sort((a, b) => (b as any).score - (a as any).score);
    const topResults = results.slice(0, topK);

    return topResults;
  }
}
