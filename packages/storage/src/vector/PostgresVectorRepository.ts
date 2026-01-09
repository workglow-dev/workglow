/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  cosineSimilarity,
  DataPortSchemaObject,
  FromSchema,
  type TypedArray,
  TypedArraySchemaOptions,
} from "@workglow/util";
import type { Pool } from "pg";
import { PostgresTabularRepository } from "../tabular/PostgresTabularRepository";
import type {
  HybridSearchOptions,
  IVectorRepository,
  VectorSearchOptions,
} from "./IVectorRepository";

/**
 * PostgreSQL vector repository implementation using pgvector extension.
 * Extends PostgresTabularRepository for storage.
 * Provides efficient vector similarity search with native database support.
 *
 * Supports custom schemas for flexibility (e.g., multi-tenant with additional columns).
 * The schema must include at least one property with format: "TypedArray" and dimension specified.
 *
 * Requirements:
 * - PostgreSQL database with pgvector extension installed
 * - CREATE EXTENSION vector;
 * - Schema must have at least one column with { type: "string", format: "TypedArray", x-dimensions: number }
 *
 * @template Schema - The schema definition for the entity
 * @template PrimaryKeyNames - Array of property names that form the primary key
 */
export class PostgresVectorRepository<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
>
  extends PostgresTabularRepository<Schema, PrimaryKeyNames, Entity>
  implements IVectorRepository<Schema, PrimaryKeyNames, Entity>
{
  private vectorColumn: string;
  private metadataColumn: string | undefined;

  /**
   * Creates a new PostgreSQL vector repository
   * @param db - PostgreSQL connection pool
   * @param table - The name of the table to use for storage
   * @param schema - Schema with at least one vector column (format: "TypedArray", x-dimensions: number)
   * @param primaryKeyNames - Array of property names that form the primary key (e.g., ["id"] or ["tenantId", "id"])
   * @param indexes - Array of columns or column arrays to make searchable (e.g., [["tenantId"], ["docId"]])
   */
  constructor(
    db: Pool,
    table: string,
    schema: Schema,
    primaryKeyNames: PrimaryKeyNames,
    indexes: readonly (keyof Entity | readonly (keyof Entity)[])[] = []
  ) {
    super(db, table, schema, primaryKeyNames, indexes);

    // Find the vector column from the schema
    const vectorColumns = this.findVectorColumns(schema);
    if (vectorColumns.length === 0) {
      throw new Error(
        `Schema must have at least one property with format: "TypedArray" and x-dimensions specified`
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
      if (typeDef.format === "TypedArray" && typeof typeDef["x-dimensions"] === "number") {
        vectorColumns.push({ column: key, dimension: typeDef["x-dimensions"] });
      }
    }

    return vectorColumns;
  }

  /**
   * Finds the metadata column in the schema
   */
  private findMetadataColumn(schema: Schema): string | undefined {
    for (const [key, typeDef] of Object.entries(schema.properties)) {
      if (typeDef?.format === "metadata") {
        return key;
      }
    }
    return undefined;
  }

  async similaritySearch(
    query: TypedArray,
    options: VectorSearchOptions<Record<string, unknown>> = {}
  ): Promise<Array<Entity & { score: number }>> {
    const { topK = 10, filter, scoreThreshold = 0 } = options;

    try {
      // Try native pgvector search first
      const queryVector = `[${Array.from(query).join(",")}]`;
      let sql = `
        SELECT 
          *,
          1 - ("${this.vectorColumn}" <=> $1::vector) as score
        FROM "${this.table}"
      `;

      const params: any[] = [queryVector];
      let paramIndex = 2;

      if (filter && Object.keys(filter).length > 0) {
        const conditions: string[] = [];
        for (const [key, value] of Object.entries(filter)) {
          conditions.push(`${this.metadataColumn}->>'${key}' = $${paramIndex}`);
          params.push(String(value));
          paramIndex++;
        }
        sql += ` WHERE ${conditions.join(" AND ")}`;
      }

      if (scoreThreshold > 0) {
        sql += filter ? " AND" : " WHERE";
        sql += ` (1 - ("${this.vectorColumn}" <=> $1::vector)) >= $${paramIndex}`;
        params.push(scoreThreshold);
        paramIndex++;
      }

      sql += ` ORDER BY "${this.vectorColumn}" <=> $1::vector LIMIT $${paramIndex}`;
      params.push(topK);

      const result = await this.db.query(sql, params);

      // Fetch vectors separately for each result
      const results: Array<Entity & { score: number }> = [];
      for (const row of result.rows) {
        const vectorResult = await this.db.query(
          `SELECT "${this.vectorColumn}"::text FROM "${this.table}" WHERE id = $1`,
          [row.id]
        );
        const vectorStr = vectorResult.rows[0]?.[this.vectorColumn] || "[]";
        const vectorArray = JSON.parse(vectorStr);

        results.push({
          ...row,
          vector: new Float32Array(vectorArray),
          score: parseFloat(row.score),
        } as any);
      }

      return results;
    } catch (error) {
      // Fall back to in-memory similarity calculation if pgvector is not available
      console.warn("pgvector query failed, falling back to in-memory search:", error);
      return this.searchFallback(query, options);
    }
  }

  async hybridSearch(query: TypedArray, options: HybridSearchOptions<Record<string, unknown>>) {
    const { topK = 10, filter, scoreThreshold = 0, textQuery, vectorWeight = 0.7 } = options;

    if (!textQuery || textQuery.trim().length === 0) {
      return this.similaritySearch(query, { topK, filter, scoreThreshold });
    }

    try {
      // Try native hybrid search with pgvector + full-text
      const queryVector = `[${Array.from(query).join(",")}]`;
      const tsQuery = textQuery.split(/\s+/).join(" & ");

      let sql = `
        SELECT 
          *,
          (
            $2 * (1 - ("${this.vectorColumn}" <=> $1::vector)) +
            $3 * ts_rank(to_tsvector('english', ${this.metadataColumn}::text), to_tsquery('english', $4))
          ) as score
        FROM "${this.table}"
      `;

      const params: any[] = [queryVector, vectorWeight, 1 - vectorWeight, tsQuery];
      let paramIndex = 5;

      if (filter && Object.keys(filter).length > 0) {
        const conditions: string[] = [];
        for (const [key, value] of Object.entries(filter)) {
          conditions.push(`${this.metadataColumn}->>'${key}' = $${paramIndex}`);
          params.push(String(value));
          paramIndex++;
        }
        sql += ` WHERE ${conditions.join(" AND ")}`;
      }

      if (scoreThreshold > 0) {
        sql += filter ? " AND" : " WHERE";
        sql += ` (
          $2 * (1 - ("${this.vectorColumn}" <=> $1::vector)) +
          $3 * ts_rank(to_tsvector('english', ${this.metadataColumn}::text), to_tsquery('english', $4))
        ) >= $${paramIndex}`;
        params.push(scoreThreshold);
        paramIndex++;
      }

      sql += ` ORDER BY score DESC LIMIT $${paramIndex}`;
      params.push(topK);

      const result = await this.db.query(sql, params);

      // Fetch vectors separately for each result
      const results: Array<Entity & { score: number }> = [];
      for (const row of result.rows) {
        const vectorResult = await this.db.query(
          `SELECT "${this.vectorColumn}"::text FROM "${this.table}" WHERE id = $1`,
          [row.id]
        );
        const vectorStr = vectorResult.rows[0]?.[this.vectorColumn] || "[]";
        const vectorArray = JSON.parse(vectorStr);

        results.push({
          ...row,
          vector: new Float32Array(vectorArray),
          score: parseFloat(row.score),
        } as any);
      }

      return results;
    } catch (error) {
      // Fall back to in-memory hybrid search
      console.warn("pgvector hybrid query failed, falling back to in-memory search:", error);
      return this.hybridSearchFallback(query, options);
    }
  }

  /**
   * Fallback search using in-memory cosine similarity
   */
  private async searchFallback(
    query: TypedArray,
    options: VectorSearchOptions<Record<string, unknown>>
  ) {
    const { topK = 10, filter, scoreThreshold = 0 } = options;
    const allRows = (await this.getAll()) || [];
    const results: Array<Entity & { score: number }> = [];

    for (const row of allRows) {
      const vector = row[this.vectorColumn as keyof typeof row] as TypedArray;
      const metadata = row[this.metadataColumn as keyof typeof row] as Record<string, unknown>;

      if (filter && !this.matchesFilter(metadata, filter)) {
        continue;
      }

      const score = cosineSimilarity(query, vector);

      if (score >= scoreThreshold) {
        results.push({ ...row, vector, score } as any);
      }
    }

    results.sort((a, b) => (b as any).score - (a as any).score);
    const topResults = results.slice(0, topK);

    return topResults;
  }

  /**
   * Fallback hybrid search
   */
  private async hybridSearchFallback(
    query: TypedArray,
    options: HybridSearchOptions<Record<string, unknown>>
  ) {
    const { topK = 10, filter, scoreThreshold = 0, textQuery, vectorWeight = 0.7 } = options;

    const allRows = (await this.getAll()) || [];
    const results: Array<Entity & { score: number }> = [];
    const queryLower = textQuery.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);

    for (const row of allRows) {
      const vector = row[this.vectorColumn as keyof typeof row] as TypedArray;
      const metadata = row[this.metadataColumn as keyof typeof row] as Record<string, unknown>;

      if (filter && !this.matchesFilter(metadata, filter)) {
        continue;
      }

      const vectorScore = cosineSimilarity(query, vector);
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

      const combinedScore = vectorWeight * vectorScore + (1 - vectorWeight) * textScore;

      if (combinedScore >= scoreThreshold) {
        results.push({ ...row, vector, score: combinedScore } as any);
      }
    }

    results.sort((a, b) => (b as any).score - (a as any).score);
    const topResults = results.slice(0, topK);

    return topResults;
  }

  private matchesFilter(
    metadata: Record<string, unknown>,
    filter: Partial<Record<string, unknown>>
  ): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (metadata[key as keyof Record<string, unknown>] !== value) {
        return false;
      }
    }
    return true;
  }
}
