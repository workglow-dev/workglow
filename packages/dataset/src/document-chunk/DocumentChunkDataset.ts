/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { VectorSearchOptions } from "@workglow/storage";
import type { TypedArray } from "@workglow/util";
import type {
  DocumentChunk,
  DocumentChunkKey,
  DocumentChunkStorage,
  InsertDocumentChunk,
} from "./DocumentChunkSchema";

/**
 * Document Chunk Dataset
 *
 * A dataset-specific wrapper around vector storage for document chunks.
 * This provides a domain-specific API for working with document chunk embeddings
 * in RAG pipelines.
 */
export class DocumentChunkDataset {
  private storage: DocumentChunkStorage;

  constructor(storage: DocumentChunkStorage) {
    this.storage = storage;
  }

  /**
   * Get the underlying storage instance
   */
  getStorage(): DocumentChunkStorage {
    return this.storage;
  }

  /**
   * Store a document chunk
   */
  async put(chunk: InsertDocumentChunk): Promise<DocumentChunk> {
    return this.storage.put(chunk);
  }

  /**
   * Store multiple document chunks
   */
  async putBulk(chunks: InsertDocumentChunk[]): Promise<DocumentChunk[]> {
    return this.storage.putBulk(chunks);
  }

  /**
   * Get a document chunk by ID
   */
  async get(chunk_id: string): Promise<DocumentChunk | undefined> {
    const key: DocumentChunkKey = { chunk_id };
    return this.storage.get(key);
  }

  /**
   * Delete a document chunk
   */
  async delete(chunk_id: string): Promise<void> {
    const key: DocumentChunkKey = { chunk_id };
    return this.storage.delete(key);
  }

  /**
   * Search for similar chunks using vector similarity
   */
  async similaritySearch(
    query: TypedArray,
    options?: VectorSearchOptions<Record<string, unknown>>
  ): Promise<Array<DocumentChunk & { score: number }>> {
    return this.storage.similaritySearch(query, options);
  }

  /**
   * Hybrid search (vector + full-text)
   */
  async hybridSearch(
    query: TypedArray,
    options: VectorSearchOptions<Record<string, unknown>> & {
      textQuery: string;
      vectorWeight?: number;
    }
  ): Promise<Array<DocumentChunk & { score: number }>> {
    if (this.storage.hybridSearch) {
      return this.storage.hybridSearch(query, options);
    }
    throw new Error("Hybrid search not supported by this storage backend");
  }

  /**
   * Get all chunks
   */
  async getAll(): Promise<DocumentChunk[] | undefined> {
    return this.storage.getAll();
  }

  /**
   * Get the count of stored chunks
   */
  async size(): Promise<number> {
    return this.storage.size();
  }

  /**
   * Clear all chunks
   */
  async clear(): Promise<void> {
    return (this.storage as any).clear();
  }

  /**
   * Destroy the storage
   */
  destroy(): void {
    return this.storage.destroy();
  }

  /**
   * Setup the database/storage
   */
  async setupDatabase(): Promise<void> {
    return this.storage.setupDatabase();
  }

  /**
   * Get the vector dimensions
   */
  getVectorDimensions(): number {
    return this.storage.getVectorDimensions();
  }
}
