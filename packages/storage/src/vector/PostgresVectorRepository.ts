/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { cosineSimilarity, DataPortSchemaObject, EventEmitter, TypedArray } from "@workglow/util";
import type { Pool } from "pg";
import { PostgresTabularRepository } from "../tabular/PostgresTabularRepository";
import {
  HybridSearchOptions,
  IVectorRepository,
  SearchResult,
  VectorEntry,
  VectorEventListeners,
  VectorSearchOptions,
} from "./IVectorRepository";

/**
 * Schema for vector storage in tabular format
 */
const VectorSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    vector_data: { type: "string" }, // JSON-encoded vector for fallback
    metadata: { type: "string" }, // JSON-encoded metadata
    created_at: { type: "string" }, // timestamp
  },
  required: ["id", "vector_data", "metadata"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

type VectorRow = {
  id: string;
  vector_data: string;
  metadata: string;
  created_at?: string;
};

/**
 * PostgreSQL vector repository implementation using pgvector extension.
 * Uses tabular repository underneath for consistency.
 * Provides efficient vector similarity search with native database support.
 *
 * Requirements:
 * - PostgreSQL database with pgvector extension installed
 * - CREATE EXTENSION vector;
 *
 * @template Metadata - Type for metadata associated with vectors
 * @template VectorChoice - Type of vector array (Float32Array, Int8Array, etc.)
 */
export class PostgresVectorRepository<
  Metadata = Record<string, unknown>,
  VectorChoice extends TypedArray = Float32Array,
>
  extends EventEmitter<VectorEventListeners<Metadata, VectorChoice>>
  implements IVectorRepository<Metadata, VectorChoice>
{
  private tabularRepo: PostgresTabularRepository<typeof VectorSchema, ["id"]>;
  private db: Pool;
  private table: string;
  private vectorDimension: number;
  private initialized = false;
  private useNativeVector = false;

  /**
   * Creates a new PostgreSQL vector repository
   * @param db - PostgreSQL connection pool
   * @param table - The name of the table to use for storage (defaults to 'vectors')
   * @param vectorDimension - Dimension of vectors (e.g., 384, 768, 1536)
   */
  constructor(db: Pool, table: string = "vectors", vectorDimension: number = 384) {
    super();
    this.db = db;
    this.table = table;
    this.vectorDimension = vectorDimension;
    this.tabularRepo = new PostgresTabularRepository(
      db,
      table,
      VectorSchema,
      ["id"] as const,
      [] // We'll create custom indexes
    );
  }

  async setupDatabase(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Check if pgvector is available
    try {
      await this.db.query("CREATE EXTENSION IF NOT EXISTS vector");
      this.useNativeVector = true;

      // Create table with native vector column
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS "${this.table}" (
          id TEXT PRIMARY KEY,
          vector vector(${this.vectorDimension}),
          vector_data TEXT NOT NULL,
          metadata JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      // Create HNSW index for fast similarity search
      await this.db.query(`
        CREATE INDEX IF NOT EXISTS "${this.table}_vector_idx"
        ON "${this.table}"
        USING hnsw (vector vector_cosine_ops)
      `);

      // Create GIN index on metadata for filtering
      await this.db.query(`
        CREATE INDEX IF NOT EXISTS "${this.table}_metadata_idx"
        ON "${this.table}"
        USING gin (metadata)
      `);
    } catch (error) {
      console.warn("pgvector not available, falling back to tabular storage:", error);
      this.useNativeVector = false;
      // Fall back to tabular repository
      await this.tabularRepo.setupDatabase();
    }

    this.initialized = true;
  }

  async upsert(id: string, vector: VectorChoice, metadata: Metadata): Promise<void> {
    const vectorArray = Array.from(vector);
    const vectorJson = JSON.stringify(vectorArray);
    const metadataJson = JSON.stringify(metadata);

    if (this.useNativeVector) {
      const vectorStr = `[${vectorArray.join(",")}]`;
      await this.db.query(
        `
        INSERT INTO "${this.table}" (id, vector, vector_data, metadata)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE
        SET vector = EXCLUDED.vector, vector_data = EXCLUDED.vector_data, metadata = EXCLUDED.metadata
      `,
        [id, vectorStr, vectorJson, metadataJson]
      );
    } else {
      await this.tabularRepo.put({
        id,
        vector_data: vectorJson,
        metadata: metadataJson,
        created_at: new Date().toISOString(),
      });
    }

    this.emit("upsert", { id, vector, metadata });
  }

  async upsertBulk(items: VectorEntry<Metadata, VectorChoice>[]): Promise<void> {
    if (items.length === 0) return;

    if (this.useNativeVector) {
      const values: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      for (const item of items) {
        const vectorArray = Array.from(item.vector);
        const vectorStr = `[${vectorArray.join(",")}]`;
        const vectorJson = JSON.stringify(vectorArray);
        const metadataJson = JSON.stringify(item.metadata);

        values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3})`);
        params.push(item.id, vectorStr, vectorJson, metadataJson);
        paramIndex += 4;
      }

      await this.db.query(
        `
        INSERT INTO "${this.table}" (id, vector, vector_data, metadata)
        VALUES ${values.join(", ")}
        ON CONFLICT (id) DO UPDATE
        SET vector = EXCLUDED.vector, vector_data = EXCLUDED.vector_data, metadata = EXCLUDED.metadata
      `,
        params
      );
    } else {
      const rows: VectorRow[] = items.map((item) => ({
        id: item.id,
        vector_data: JSON.stringify(Array.from(item.vector)),
        metadata: JSON.stringify(item.metadata),
        created_at: new Date().toISOString(),
      }));
      await this.tabularRepo.putBulk(rows);
    }

    for (const item of items) {
      this.emit("upsert", item);
    }
  }

  async search(
    query: VectorChoice,
    options: VectorSearchOptions<Metadata, VectorChoice> = {}
  ): Promise<SearchResult<Metadata, VectorChoice>[]> {
    const { topK = 10, filter, scoreThreshold = 0 } = options;

    if (this.useNativeVector) {
      const queryVector = `[${Array.from(query).join(",")}]`;
      let sql = `
        SELECT 
          id,
          vector_data,
          metadata,
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

      const results: SearchResult<Metadata, VectorChoice>[] = result.rows.map((row) => ({
        id: row.id,
        vector: this.deserializeVector(row.vector_data),
        metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
        score: parseFloat(row.score),
      }));

      this.emit("search", query, results);
      return results;
    } else {
      // Fall back to in-memory similarity calculation
      return this.searchFallback(query, options);
    }
  }

  async hybridSearch(
    query: VectorChoice,
    options: HybridSearchOptions<Metadata, VectorChoice>
  ): Promise<SearchResult<Metadata, VectorChoice>[]> {
    const { topK = 10, filter, scoreThreshold = 0, textQuery, vectorWeight = 0.7 } = options;

    if (!textQuery || textQuery.trim().length === 0) {
      return this.search(query, { topK, filter, scoreThreshold });
    }

    if (this.useNativeVector) {
      const queryVector = `[${Array.from(query).join(",")}]`;
      const tsQuery = textQuery.split(/\s+/).join(" & ");

      let sql = `
        SELECT 
          id,
          vector_data,
          metadata,
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

      const results: SearchResult<Metadata, VectorChoice>[] = result.rows.map((row) => ({
        id: row.id,
        vector: this.deserializeVector(row.vector_data),
        metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
        score: parseFloat(row.score),
      }));

      this.emit("search", query, results);
      return results;
    } else {
      return this.hybridSearchFallback(query, options);
    }
  }

  async get(id: string): Promise<VectorEntry<Metadata, VectorChoice> | undefined> {
    if (this.useNativeVector) {
      const result = await this.db.query(
        `SELECT id, vector_data, metadata FROM "${this.table}" WHERE id = $1`,
        [id]
      );

      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          id: row.id,
          vector: this.deserializeVector(row.vector_data),
          metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
        };
      }
      return undefined;
    } else {
      const row = await this.tabularRepo.get({ id });
      if (row) {
        return {
          id: row.id,
          vector: this.deserializeVector(row.vector_data),
          metadata: JSON.parse(row.metadata) as Metadata,
        };
      }
      return undefined;
    }
  }

  async delete(id: string): Promise<void> {
    if (this.useNativeVector) {
      await this.db.query(`DELETE FROM "${this.table}" WHERE id = $1`, [id]);
    } else {
      await this.tabularRepo.delete({ id });
    }
    this.emit("delete", id);
  }

  async deleteBulk(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    if (this.useNativeVector) {
      await this.db.query(`DELETE FROM "${this.table}" WHERE id = ANY($1)`, [ids]);
    } else {
      for (const id of ids) {
        await this.tabularRepo.delete({ id });
      }
    }

    for (const id of ids) {
      this.emit("delete", id);
    }
  }

  async deleteByFilter(filter: Partial<Metadata>): Promise<void> {
    if (Object.keys(filter).length === 0) return;

    if (this.useNativeVector) {
      const conditions: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(filter)) {
        conditions.push(`metadata->>'${key}' = $${paramIndex}`);
        params.push(String(value));
        paramIndex++;
      }

      await this.db.query(`DELETE FROM "${this.table}" WHERE ${conditions.join(" AND ")}`, params);
    } else {
      const allRows = (await this.tabularRepo.getAll()) || [];
      const idsToDelete: string[] = [];

      for (const row of allRows) {
        const metadata = JSON.parse(row.metadata) as Metadata;
        if (this.matchesFilter(metadata, filter)) {
          idsToDelete.push(row.id);
        }
      }

      await this.deleteBulk(idsToDelete);
    }
  }

  async size(): Promise<number> {
    if (this.useNativeVector) {
      const result = await this.db.query(`SELECT COUNT(*) as count FROM "${this.table}"`);
      return parseInt(result.rows[0].count);
    } else {
      return await this.tabularRepo.size();
    }
  }

  async clear(): Promise<void> {
    if (this.useNativeVector) {
      await this.db.query(`DELETE FROM "${this.table}"`);
    } else {
      await this.tabularRepo.deleteAll();
    }
  }

  destroy(): void {
    if (!this.useNativeVector) {
      this.tabularRepo.destroy();
    }
    this.removeAllListeners();
  }

  /**
   * Fallback search using in-memory cosine similarity
   */
  private async searchFallback(
    query: VectorChoice,
    options: VectorSearchOptions<Metadata, VectorChoice>
  ): Promise<SearchResult<Metadata, VectorChoice>[]> {
    const { topK = 10, filter, scoreThreshold = 0 } = options;
    const allRows = (await this.tabularRepo.getAll()) || [];
    const results: SearchResult<Metadata, VectorChoice>[] = [];

    for (const row of allRows) {
      const vector = this.deserializeVector(row.vector_data);
      const metadata = JSON.parse(row.metadata) as Metadata;

      if (filter && !this.matchesFilter(metadata, filter)) {
        continue;
      }

      const score = cosineSimilarity(query, vector);

      if (score >= scoreThreshold) {
        results.push({ id: row.id, vector, metadata, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    this.emit("search", query, topResults);
    return topResults;
  }

  /**
   * Fallback hybrid search
   */
  private async hybridSearchFallback(
    query: VectorChoice,
    options: HybridSearchOptions<Metadata, VectorChoice>
  ): Promise<SearchResult<Metadata, VectorChoice>[]> {
    const { topK = 10, filter, scoreThreshold = 0, textQuery, vectorWeight = 0.7 } = options;

    const allRows = (await this.tabularRepo.getAll()) || [];
    const results: SearchResult<Metadata, VectorChoice>[] = [];
    const queryLower = textQuery.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);

    for (const row of allRows) {
      const vector = this.deserializeVector(row.vector_data);
      const metadata = JSON.parse(row.metadata) as Metadata;

      if (filter && !this.matchesFilter(metadata, filter)) {
        continue;
      }

      const vectorScore = cosineSimilarity(query, vector);
      const metadataText = row.metadata.toLowerCase();
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
        results.push({ id: row.id, vector, metadata, score: combinedScore });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    this.emit("search", query, topResults);
    return topResults;
  }

  private deserializeVector(vectorJson: string): VectorChoice {
    const array = JSON.parse(vectorJson);
    const hasFloats = array.some((v: number) => v % 1 !== 0);
    const hasNegatives = array.some((v: number) => v < 0);

    if (hasFloats) {
      return new Float32Array(array) as VectorChoice;
    } else if (hasNegatives) {
      const min = Math.min(...array);
      const max = Math.max(...array);
      if (min >= -128 && max <= 127) {
        return new Int8Array(array) as VectorChoice;
      } else {
        return new Int16Array(array) as VectorChoice;
      }
    } else {
      const max = Math.max(...array);
      if (max <= 255) {
        return new Uint8Array(array) as VectorChoice;
      } else {
        return new Uint16Array(array) as VectorChoice;
      }
    }
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
