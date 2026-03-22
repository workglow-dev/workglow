/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ChunkVectorEntity,
  ChunkVectorPrimaryKey,
  ChunkVectorStorageSchema,
  DocumentStorageKey,
  DocumentStorageSchema,
  KnowledgeBase,
  knowledgeBaseTableNames,
  registerKnowledgeBase,
} from "@workglow/knowledge-base";
import type { Sqlite } from "@workglow/sqlite";
import { SqliteAiVectorStorage, SqliteTabularStorage } from "@workglow/storage";
import type { TypedArray } from "@workglow/util/schema";

export interface CreateSqliteKnowledgeBaseOptions {
  readonly name: string;
  readonly db: string | Sqlite.Database;
  readonly vectorDimensions: number;
  readonly vectorType?: { new (array: number[]): TypedArray };
  readonly register?: boolean;
  readonly title?: string;
  readonly description?: string;
}

/**
 * Factory function to create a KnowledgeBase backed by SQLite storage
 * with native vector search via the @sqliteai/sqlite-vector extension.
 *
 * Uses SqliteTabularStorage for document storage and SqliteAiVectorStorage
 * for chunk vector storage with hardware-accelerated similarity search.
 *
 * @example
 * ```typescript
 * import Database from "better-sqlite3";
 *
 * const db = new Database("knowledge.db");
 * const kb = await createSqliteKnowledgeBase({
 *   name: "my-kb",
 *   db,
 *   vectorDimensions: 1024,
 * });
 * ```
 */
export async function createSqliteKnowledgeBase(
  options: CreateSqliteKnowledgeBaseOptions
): Promise<KnowledgeBase> {
  const {
    name,
    db,
    vectorDimensions,
    vectorType = Float32Array,
    register: shouldRegister = true,
    title,
    description,
  } = options;

  const tableNames = knowledgeBaseTableNames(name);

  const tabularStorage = new SqliteTabularStorage(
    db,
    tableNames.documentTable,
    DocumentStorageSchema,
    DocumentStorageKey
  );
  await tabularStorage.setupDatabase();

  const vectorStorage = new SqliteAiVectorStorage<
    typeof ChunkVectorStorageSchema,
    typeof ChunkVectorPrimaryKey,
    Float32Array,
    Record<string, unknown>,
    ChunkVectorEntity
  >(
    db,
    tableNames.chunkTable,
    ChunkVectorStorageSchema,
    ChunkVectorPrimaryKey,
    [],
    vectorDimensions,
    vectorType
  );
  await vectorStorage.setupDatabase();

  const kb = new KnowledgeBase(name, tabularStorage, vectorStorage, title, description);

  if (shouldRegister) {
    await registerKnowledgeBase(name, kb);
  }

  return kb;
}
