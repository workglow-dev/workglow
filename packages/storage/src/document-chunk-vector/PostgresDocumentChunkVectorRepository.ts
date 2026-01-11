/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { cosineSimilarity, type TypedArray } from "@workglow/util";
import type { Pool } from "pg";
import { PostgresTabularRepository } from "../tabular/PostgresTabularRepository";
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
 * PostgreSQL document chunk vector repository implementation using pgvector extension.
 * Extends PostgresTabularRepository for storage.
 * Provides efficient vector similarity search with native database support.
 *
 * Requirements:
 * - PostgreSQL database with pgvector extension installed
 * - CREATE EXTENSION vector;
 *
 * @template Metadata - The metadata type for the document chunk
 * @template Vector - The vector type for the document chunk
 */
export class PostgresDocumentChunkVectorRepository<
  Metadata extends Record<string, unknown> = Record<string, unknown>,
  Vector extends TypedArray = Float32Array,
>
  extends PostgresTabularRepository<
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
   * Creates a new PostgreSQL document chunk vector repository
   * @param db - PostgreSQL connection pool
   * @param table - The name of the table to use for storage
   * @param dimensions - The number of dimensions of the vector
   * @param VectorType - The type of vector to use (defaults to Float32Array)
   */
  constructor(
    db: Pool,
    table: string,
    dimensions: number,
    VectorType: new (array: number[]) => TypedArray = Float32Array
  ) {
    super(db, table, DocumentChunkVectorSchema, DocumentChunkVectorKey);

    this.vectorDimensions = dimensions;
    this.VectorType = VectorType;
  }

  getVectorDimensions(): number {
    return this.vectorDimensions;
  }

  async similaritySearch(
    query: TypedArray,
    options: VectorSearchOptions<Metadata> = {}
  ): Promise<Array<DocumentChunkVector<Metadata, Vector> & { score: number }>> {
    const { topK = 10, filter, scoreThreshold = 0 } = options;

    try {
      // Try native pgvector search first
      const queryVector = `[${Array.from(query).join(",")}]`;
      let sql = `
        SELECT 
          *,
          1 - (vector <=> $1::vector) as score
        FROM "${this.table}"
      `;

      const params: any[] = [queryVector];
      let paramIndex = 2;

      if (filter && Object.keys(filter).length > 0) {
        const conditions: string[] = [];
        for (const [key, value] of Object.entries(filter)) {
          conditions.push(`metadata->>'${key}' = $${paramIndex}`);
          params.push(String(value));
          paramIndex++;
        }
        sql += ` WHERE ${conditions.join(" AND ")}`;
      }

      if (scoreThreshold > 0) {
        sql += filter ? " AND" : " WHERE";
        sql += ` (1 - (vector <=> $1::vector)) >= $${paramIndex}`;
        params.push(scoreThreshold);
        paramIndex++;
      }

      sql += ` ORDER BY vector <=> $1::vector LIMIT $${paramIndex}`;
      params.push(topK);

      const result = await this.db.query(sql, params);

      // Fetch vectors separately for each result
      const results: Array<DocumentChunkVector<Metadata, Vector> & { score: number }> = [];
      for (const row of result.rows) {
        const vectorResult = await this.db.query(
          `SELECT vector::text FROM "${this.table}" WHERE id = $1`,
          [row.id]
        );
        const vectorStr = vectorResult.rows[0]?.vector || "[]";
        const vectorArray = JSON.parse(vectorStr);

        results.push({
          ...row,
          vector: new this.VectorType(vectorArray),
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

  async hybridSearch(query: TypedArray, options: HybridSearchOptions<Metadata>) {
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
            $2 * (1 - (vector <=> $1::vector)) +
            $3 * ts_rank(to_tsvector('english', metadata::text), to_tsquery('english', $4))
          ) as score
        FROM "${this.table}"
      `;

      const params: any[] = [queryVector, vectorWeight, 1 - vectorWeight, tsQuery];
      let paramIndex = 5;

      if (filter && Object.keys(filter).length > 0) {
        const conditions: string[] = [];
        for (const [key, value] of Object.entries(filter)) {
          conditions.push(`metadata->>'${key}' = $${paramIndex}`);
          params.push(String(value));
          paramIndex++;
        }
        sql += ` WHERE ${conditions.join(" AND ")}`;
      }

      if (scoreThreshold > 0) {
        sql += filter ? " AND" : " WHERE";
        sql += ` (
          $2 * (1 - (vector <=> $1::vector)) +
          $3 * ts_rank(to_tsvector('english', metadata::text), to_tsquery('english', $4))
        ) >= $${paramIndex}`;
        params.push(scoreThreshold);
        paramIndex++;
      }

      sql += ` ORDER BY score DESC LIMIT $${paramIndex}`;
      params.push(topK);

      const result = await this.db.query(sql, params);

      // Fetch vectors separately for each result
      const results: Array<DocumentChunkVector<Metadata, Vector> & { score: number }> = [];
      for (const row of result.rows) {
        const vectorResult = await this.db.query(
          `SELECT vector::text FROM "${this.table}" WHERE id = $1`,
          [row.id]
        );
        const vectorStr = vectorResult.rows[0]?.vector || "[]";
        const vectorArray = JSON.parse(vectorStr);

        results.push({
          ...row,
          vector: new this.VectorType(vectorArray),
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
  private async searchFallback(query: TypedArray, options: VectorSearchOptions<Metadata>) {
    const { topK = 10, filter, scoreThreshold = 0 } = options;
    const allRows = (await this.getAll()) || [];
    const results: Array<DocumentChunkVector<Metadata, Vector> & { score: number }> = [];

    for (const row of allRows) {
      const vector = row.vector;
      const metadata = row.metadata;

      if (filter && !this.matchesFilter(metadata, filter)) {
        continue;
      }

      const score = cosineSimilarity(query, vector);

      if (score >= scoreThreshold) {
        results.push({ ...row, vector, score });
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
    const results: Array<DocumentChunkVector<Metadata, Vector> & { score: number }> = [];
    const queryLower = textQuery.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);

    for (const row of allRows) {
      const vector = row.vector;
      const metadata = row.metadata;

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
        results.push({ ...row, vector, score: combinedScore });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    return topResults;
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
