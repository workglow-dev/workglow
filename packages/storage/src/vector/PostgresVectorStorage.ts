/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DataPortSchemaObject,
  FromSchema,
  TypedArray,
  TypedArraySchemaOptions,
} from "@workglow/util";
import { cosineSimilarity } from "@workglow/util";
import type { Pool } from "pg";
import { PostgresTabularStorage } from "../tabular/PostgresTabularStorage";
import {
  getMetadataProperty,
  getVectorProperty,
  type HybridSearchOptions,
  type IVectorStorage,
  type VectorSearchOptions,
} from "./IVectorStorage";

/**
 * PostgreSQL vector repository implementation using pgvector extension.
 * Extends PostgresTabularStorage for storage.
 * Provides efficient vector similarity search with native database support.
 *
 * Requirements:
 * - PostgreSQL database with pgvector extension installed
 * - CREATE EXTENSION vector;
 *
 * @template Metadata - The metadata type
 * @template Vector - The vector type
 */
export class PostgresVectorStorage<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
  Vector extends TypedArray = Float32Array,
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
>
  extends PostgresTabularStorage<Schema, PrimaryKeyNames, Entity>
  implements IVectorStorage<Metadata, Schema, Entity, PrimaryKeyNames>
{
  private vectorDimensions: number;
  private VectorType: new (array: number[]) => TypedArray;
  private vectorPropertyName: keyof Entity;
  private metadataPropertyName: keyof Entity | undefined;

  /**
   * Creates a new PostgreSQL vector repository
   * @param db - PostgreSQL connection pool
   * @param table - The name of the table to use for storage
   * @param schema - The schema definition for the entity
   * @param primaryKeyNames - Array of property names that form the primary key
   * @param indexes - Array of columns or column arrays to make searchable
   * @param dimensions - The number of dimensions of the vector
   * @param VectorType - The type of vector to use (defaults to Float32Array)
   */
  constructor(
    db: Pool,
    table: string,
    schema: Schema,
    primaryKeyNames: PrimaryKeyNames,
    indexes: readonly (keyof Entity | readonly (keyof Entity)[])[] = [],
    dimensions: number,
    VectorType: new (array: number[]) => TypedArray = Float32Array
  ) {
    super(db, table, schema, primaryKeyNames, indexes);

    this.vectorDimensions = dimensions;
    this.VectorType = VectorType;

    // Cache vector and metadata property names from schema
    const vectorProp = getVectorProperty(schema);
    if (!vectorProp) {
      throw new Error("Schema must have a property with type array and format TypedArray");
    }
    this.vectorPropertyName = vectorProp as keyof Entity;
    this.metadataPropertyName = getMetadataProperty(schema) as keyof Entity | undefined;
  }

  getVectorDimensions(): number {
    return this.vectorDimensions;
  }

  async similaritySearch(
    query: TypedArray,
    options: VectorSearchOptions<Metadata> = {}
  ): Promise<Array<Entity & { score: number }>> {
    const { topK = 10, filter, scoreThreshold = 0 } = options;

    try {
      // Try native pgvector search first
      const queryVector = `[${Array.from(query).join(",")}]`;
      const vectorCol = String(this.vectorPropertyName);
      const metadataCol = this.metadataPropertyName ? String(this.metadataPropertyName) : null;
      
      let sql = `
        SELECT 
          *,
          1 - (${vectorCol} <=> $1::vector) as score
        FROM "${this.table}"
      `;

      const params: any[] = [queryVector];
      let paramIndex = 2;

      if (filter && Object.keys(filter).length > 0 && metadataCol) {
        const conditions: string[] = [];
        for (const [key, value] of Object.entries(filter)) {
          conditions.push(`${metadataCol}->>'${key}' = $${paramIndex}`);
          params.push(String(value));
          paramIndex++;
        }
        sql += ` WHERE ${conditions.join(" AND ")}`;
      }

      if (scoreThreshold > 0) {
        sql += filter ? " AND" : " WHERE";
        sql += ` (1 - (${vectorCol} <=> $1::vector)) >= $${paramIndex}`;
        params.push(scoreThreshold);
        paramIndex++;
      }

      sql += ` ORDER BY ${vectorCol} <=> $1::vector LIMIT $${paramIndex}`;
      params.push(topK);

      const result = await this.db.query(sql, params);

      // Fetch vectors separately for each result
      const results: Array<Entity & { score: number }> = [];
      for (const row of result.rows) {
        const vectorResult = await this.db.query(
          `SELECT ${vectorCol}::text FROM "${this.table}" WHERE ${this.getPrimaryKeyWhereClause(row)}`,
          this.getPrimaryKeyValues(row)
        );
        const vectorStr = vectorResult.rows[0]?.[vectorCol] || "[]";
        const vectorArray = JSON.parse(vectorStr);

        results.push({
          ...row,
          [this.vectorPropertyName]: new this.VectorType(vectorArray),
          score: parseFloat(row.score),
        } as Entity & { score: number });
      }

      return results;
    } catch (error) {
      // Fall back to in-memory similarity calculation if pgvector is not available
      console.warn("pgvector query failed, falling back to in-memory search:", error);
      return this.searchFallback(query, options);
    }
  }

  async hybridSearch(query: TypedArray, options: HybridSearchOptions<Metadata>) {
    const { topK = 10, filter, scoreThreshold = 0, textQuery, vectorWeight = 0.7 } = options;

    if (!textQuery || textQuery.trim().length === 0) {
      return this.similaritySearch(query, { topK, filter, scoreThreshold });
    }

    try {
      // Try native hybrid search with pgvector + full-text
      const queryVector = `[${Array.from(query).join(",")}]`;
      const tsQuery = textQuery.split(/\s+/).join(" & ");
      const vectorCol = String(this.vectorPropertyName);
      const metadataCol = this.metadataPropertyName ? String(this.metadataPropertyName) : null;

      let sql = `
        SELECT 
          *,
          (
            $2 * (1 - (${vectorCol} <=> $1::vector)) +
            $3 * ts_rank(to_tsvector('english', ${metadataCol || "''"}::text), to_tsquery('english', $4))
          ) as score
        FROM "${this.table}"
      `;

      const params: any[] = [queryVector, vectorWeight, 1 - vectorWeight, tsQuery];
      let paramIndex = 5;

      if (filter && Object.keys(filter).length > 0 && metadataCol) {
        const conditions: string[] = [];
        for (const [key, value] of Object.entries(filter)) {
          conditions.push(`${metadataCol}->>'${key}' = $${paramIndex}`);
          params.push(String(value));
          paramIndex++;
        }
        sql += ` WHERE ${conditions.join(" AND ")}`;
      }

      if (scoreThreshold > 0) {
        sql += filter ? " AND" : " WHERE";
        sql += ` (
          $2 * (1 - (${vectorCol} <=> $1::vector)) +
          $3 * ts_rank(to_tsvector('english', ${metadataCol || "''"}::text), to_tsquery('english', $4))
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
          `SELECT ${vectorCol}::text FROM "${this.table}" WHERE ${this.getPrimaryKeyWhereClause(row)}`,
          this.getPrimaryKeyValues(row)
        );
        const vectorStr = vectorResult.rows[0]?.[vectorCol] || "[]";
        const vectorArray = JSON.parse(vectorStr);

        results.push({
          ...row,
          [this.vectorPropertyName]: new this.VectorType(vectorArray),
          score: parseFloat(row.score),
        } as Entity & { score: number });
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
  private async searchFallback(query: TypedArray, options: VectorSearchOptions<Metadata>) {
    const { topK = 10, filter, scoreThreshold = 0 } = options;
    const allRows = (await this.getAll()) || [];
    const results: Array<Entity & { score: number }> = [];

    for (const row of allRows) {
      const vector = row[this.vectorPropertyName] as TypedArray;
      const metadata = this.metadataPropertyName
        ? (row[this.metadataPropertyName] as Metadata)
        : ({} as Metadata);

      if (filter && !this.matchesFilter(metadata, filter)) {
        continue;
      }

      const score = cosineSimilarity(query, vector);

      if (score >= scoreThreshold) {
        results.push({ ...row, score } as Entity & { score: number });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    return topResults;
  }

  /**
   * Fallback hybrid search
   */
  private async hybridSearchFallback(query: TypedArray, options: HybridSearchOptions<Metadata>) {
    const { topK = 10, filter, scoreThreshold = 0, textQuery, vectorWeight = 0.7 } = options;

    const allRows = (await this.getAll()) || [];
    const results: Array<Entity & { score: number }> = [];
    const queryLower = textQuery.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);

    for (const row of allRows) {
      const vector = row[this.vectorPropertyName] as TypedArray;
      const metadata = this.metadataPropertyName
        ? (row[this.metadataPropertyName] as Metadata)
        : ({} as Metadata);

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
        results.push({ ...row, score: combinedScore } as Entity & { score: number });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    return topResults;
  }

  private getPrimaryKeyWhereClause(row: any): string {
    const conditions = this.primaryKeyNames.map(
      (key, idx) => `${String(key)} = $${idx + 1}`
    );
    return conditions.join(" AND ");
  }

  private getPrimaryKeyValues(row: any): any[] {
    return this.primaryKeyNames.map((key) => row[key]);
  }

  private matchesFilter(metadata: Metadata, filter: Partial<Metadata>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (metadata[key as keyof Metadata] !== value) {
        return false;
      }
    }
    return true;
  }
}
