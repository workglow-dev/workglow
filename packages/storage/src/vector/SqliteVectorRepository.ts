/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite } from "@workglow/sqlite";
import { cosineSimilarity, DataPortSchemaObject, EventEmitter, TypedArray } from "@workglow/util";
import { SqliteTabularRepository } from "../tabular/SqliteTabularRepository";
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
    vector: { type: "string" }, // JSON-encoded vector
    metadata: { type: "string" }, // JSON-encoded metadata
    created_at: { type: "number" },
  },
  required: ["id", "vector", "metadata"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

type VectorRow = {
  id: string;
  vector: string;
  metadata: string;
  created_at?: number;
};

/**
 * SQLite vector repository implementation using tabular storage underneath.
 * Stores vectors as JSON-encoded arrays with metadata.
 *
 * @template Metadata - Type for metadata associated with vectors
 * @template Vector - Type of vector array (Float32Array, Int8Array, etc.)
 */
export class SqliteVectorRepository<
  Metadata = Record<string, unknown>,
  VectorChoice extends TypedArray = Float32Array,
>
  extends EventEmitter<VectorEventListeners<Metadata, VectorChoice>>
  implements IVectorRepository<Metadata, VectorChoice>
{
  private tabularRepo: SqliteTabularRepository<typeof VectorSchema, ["id"]>;
  private initialized = false;

  /**
   * Creates a new SQLite vector repository
   * @param dbOrPath - Either a Database instance or a path to the SQLite database file
   * @param table - The name of the table to use for storage (defaults to 'vectors')
   */
  constructor(dbOrPath: string | Sqlite.Database, table: string = "vectors") {
    super();
    this.tabularRepo = new SqliteTabularRepository(
      dbOrPath,
      table,
      VectorSchema,
      ["id"] as const,
      [] // No additional indexes needed for now
    );
  }

  async setupDatabase(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.tabularRepo.setupDatabase();
    this.initialized = true;
  }

  async upsert(id: string, vector: VectorChoice, metadata: Metadata): Promise<void> {
    const row: VectorRow = {
      id,
      vector: JSON.stringify(Array.from(vector)),
      metadata: JSON.stringify(metadata),
      created_at: Date.now(),
    };

    await this.tabularRepo.put(row);
    this.emit("upsert", { id, vector, metadata });
  }

  async upsertBulk(items: VectorEntry<Metadata, VectorChoice>[]): Promise<void> {
    const rows: VectorRow[] = items.map((item) => ({
      id: item.id,
      vector: JSON.stringify(Array.from(item.vector)),
      metadata: JSON.stringify(item.metadata),
      created_at: Date.now(),
    }));

    await this.tabularRepo.putBulk(rows);

    for (const item of items) {
      this.emit("upsert", item);
    }
  }

  async search(
    query: VectorChoice,
    options: VectorSearchOptions<Metadata, TypedArray> = {}
  ): Promise<SearchResult<Metadata, VectorChoice>[]> {
    const { topK = 10, filter, scoreThreshold = 0 } = options;

    // Get all vectors (or filtered subset)
    const allRows = (await this.tabularRepo.getAll()) || [];
    const results: SearchResult<Metadata, VectorChoice>[] = [];

    for (const row of allRows) {
      const vector = this.deserializeVector(row.vector);
      const metadata = JSON.parse(row.metadata) as Metadata;

      // Apply metadata filter if provided
      if (filter && !this.matchesFilter(metadata, filter)) {
        continue;
      }

      // Calculate similarity
      const score = cosineSimilarity(query, vector);

      if (score >= scoreThreshold) {
        results.push({
          id: row.id,
          vector,
          metadata,
          score,
        });
      }
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
      return this.search(query, { topK, filter, scoreThreshold });
    }

    const allRows = (await this.tabularRepo.getAll()) || [];
    const results: SearchResult<Metadata, VectorChoice>[] = [];
    const queryLower = textQuery.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);

    for (const row of allRows) {
      const vector = this.deserializeVector(row.vector);
      const metadata = JSON.parse(row.metadata) as Metadata;

      if (filter && !this.matchesFilter(metadata, filter)) {
        continue;
      }

      // Vector similarity
      const vectorScore = cosineSimilarity(query, vector);

      // Text relevance
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

      // Combined score
      const combinedScore = vectorWeight * vectorScore + (1 - vectorWeight) * textScore;

      if (combinedScore >= scoreThreshold) {
        results.push({
          id: row.id,
          vector,
          metadata,
          score: combinedScore,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    this.emit("search", query, topResults);
    return topResults;
  }

  async get(id: string): Promise<VectorEntry<Metadata, VectorChoice> | undefined> {
    const row = await this.tabularRepo.get({ id });
    if (row) {
      return {
        id: row.id,
        vector: this.deserializeVector(row.vector),
        metadata: JSON.parse(row.metadata) as Metadata,
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
      await this.tabularRepo.delete({ id });
      this.emit("delete", id);
    }
  }

  async deleteByFilter(filter: Partial<Metadata>): Promise<void> {
    if (Object.keys(filter).length === 0) return;

    // Get all and filter in memory (SQLite doesn't have JSON query operators)
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

  async size(): Promise<number> {
    return await this.tabularRepo.size();
  }

  async clear(): Promise<void> {
    await this.tabularRepo.deleteAll();
  }

  destroy(): void {
    this.tabularRepo.destroy();
    this.removeAllListeners();
  }

  /**
   * Deserialize vector from JSON string
   */
  private deserializeVector(vectorJson: string): VectorChoice {
    const array = JSON.parse(vectorJson);
    // Try to infer the type from the values
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

  /**
   * Check if metadata matches filter
   */
  private matchesFilter(metadata: Metadata, filter: Partial<Metadata>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (metadata[key as keyof Metadata] !== value) {
        return false;
      }
    }
    return true;
  }
}
