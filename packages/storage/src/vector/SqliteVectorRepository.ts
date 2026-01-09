/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite } from "@workglow/sqlite";
import type { DataPortSchemaObject, TypedArray, TypedArraySchemaOptions } from "@workglow/util";
import { cosineSimilarity, FromSchema } from "@workglow/util";
import { SqliteTabularRepository } from "../tabular/SqliteTabularRepository";
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
 * SQLite vector repository implementation using tabular storage underneath.
 * Stores vectors as JSON-encoded arrays with metadata.
 *
 * Supports custom schemas for flexibility (e.g., multi-tenant with additional columns).
 * The schema must have at least one column with { type: "string", format: "TypedArray", x-dimensions: number }
 *
 * @template Schema - The schema definition for the entity using JSON Schema
 * @template PrimaryKeyNames - Array of property names that form the primary key
 * @template Entity - The entity type
 */
export class SqliteVectorRepository<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
>
  extends SqliteTabularRepository<Schema, PrimaryKeyNames, Entity>
  implements IVectorRepository<Schema, PrimaryKeyNames, Entity>
{
  private vectorColumn: string;
  private metadataColumn: string | undefined;

  /**
   * Creates a new SQLite vector repository
   * @param dbOrPath - Either a Database instance or a path to the SQLite database file
   * @param table - The name of the table to use for storage (defaults to 'vectors')
   * @param schema - Schema with at least one vector column (format: "TypedArray", x-dimensions: number)
   * @param primaryKeyNames - Array of property names that form the primary key (e.g., ["id"] or ["tenantId", "id"])
   * @param indexes - Array of columns or column arrays to make searchable (e.g., [["tenantId"], ["docId"]])
   */
  constructor(
    dbOrPath: string | Sqlite.Database,
    table: string = "vectors",
    schema: Schema,
    primaryKeyNames: PrimaryKeyNames,
    indexes: readonly (keyof Entity | readonly (keyof Entity)[])[] = []
  ) {
    super(dbOrPath, table, schema, primaryKeyNames, indexes);

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
        (typeDef as { format?: string }).format === "TypedArray" &&
        typeof (typeDef as { "x-dimensions": number })["x-dimensions"] === "number"
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

  /**
   * Deserialize vector from JSON string
   * Defaults to Float32Array for compatibility with typical embedding vectors
   */
  private deserializeVector(vectorJson: string): TypedArray {
    const array = JSON.parse(vectorJson);
    // Default to Float32Array for typical use case (embeddings)
    return new Float32Array(array);
  }

  async similaritySearch(
    query: TypedArray,
    options: VectorSearchOptions<Record<string, unknown>> = {}
  ) {
    const { topK = 10, filter, scoreThreshold = 0 } = options;
    const results: Array<Entity & { score: number }> = [];

    const allEntities = (await this.getAll()) || [];

    for (const entity of allEntities) {
      // SQLite stores vectors as JSON strings, need to deserialize
      const vectorRaw = entity[this.vectorColumn as keyof typeof entity];
      const vector =
        typeof vectorRaw === "string"
          ? this.deserializeVector(vectorRaw)
          : (vectorRaw as TypedArray);
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
    const queryLower = textQuery.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);

    for (const entity of allEntities) {
      // SQLite stores vectors as JSON strings, need to deserialize
      const vectorRaw = entity[this.vectorColumn as keyof typeof entity];
      const vector =
        typeof vectorRaw === "string"
          ? this.deserializeVector(vectorRaw)
          : (vectorRaw as TypedArray);
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
