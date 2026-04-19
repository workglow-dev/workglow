/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HybridSearchOptions, VectorSearchOptions } from "@workglow/storage";
import type { TypedArray } from "@workglow/util/schema";
import type { ChunkRecord } from "../chunk/ChunkSchema";
import type {
  ChunkSearchResult,
  ChunkVectorEntity,
  ChunkVectorStorage,
  InsertChunkVectorEntity,
} from "../chunk/ChunkVectorStorageSchema";
import { Document } from "../document/Document";
import type { DocumentNode } from "../document/DocumentSchema";
import type {
  DocumentStorageEntity,
  DocumentTabularStorage,
  InsertDocumentStorageEntity,
} from "../document/DocumentStorageSchema";

/**
 * Options passed through `kb.search()` to the `onSearch` callback.
 * The callback decides how to interpret them (similarity vs hybrid, etc.).
 * `filter` is intentionally a loose record — the callback and its backing
 * vector storage define the allowed keys.
 */
export interface ISearchOptions {
  readonly topK?: number;
  readonly filter?: Readonly<Record<string, unknown>>;
  readonly scoreThreshold?: number;
}

/**
 * Callback invoked after a document is upserted.
 * Receives the KB instance and the upserted document.
 */
export type OnDocumentUpsertCallback = (kb: KnowledgeBase, doc: Document) => Promise<void>;

/**
 * Callback invoked after a document (and its chunks) are deleted.
 * Receives the KB instance and the deleted document's ID.
 */
export type OnDocumentDeleteCallback = (kb: KnowledgeBase, doc_id: string) => Promise<void>;

/**
 * Callback invoked by `search()` to handle text-to-vector conversion
 * and the actual search. Returns search results.
 */
export type OnSearchCallback = (
  kb: KnowledgeBase,
  query: string,
  options?: ISearchOptions
) => Promise<ChunkSearchResult[]>;

export interface KnowledgeBaseOptions {
  readonly title?: string;
  readonly description?: string;
  readonly onDocumentUpsert?: OnDocumentUpsertCallback;
  readonly onDocumentDelete?: OnDocumentDeleteCallback;
  readonly onSearch?: OnSearchCallback;
}

/**
 * Unified KnowledgeBase that owns both document and vector storage,
 * providing lifecycle management and cascading deletes.
 */
export class KnowledgeBase {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  private readonly tabularStorage: DocumentTabularStorage;
  private readonly chunkStorage: ChunkVectorStorage;

  /**
   * Called after `upsertDocument` successfully writes to storage.
   * Awaited — throwing rejects the upsert call, but storage is already committed.
   * Use for chunk re-indexing, audit logging, etc.
   */
  readonly onDocumentUpsert: OnDocumentUpsertCallback | undefined;
  /**
   * Called after `deleteDocument` successfully deletes the document and its chunks.
   * Awaited — throwing rejects the delete call, but storage is already committed.
   */
  readonly onDocumentDelete: OnDocumentDeleteCallback | undefined;
  /**
   * Called by `search()` to embed the query and execute the search.
   * Required if you intend to call `kb.search()`.
   */
  readonly onSearch: OnSearchCallback | undefined;

  constructor(
    name: string,
    documentStorage: DocumentTabularStorage,
    chunkStorage: ChunkVectorStorage,
    options?: KnowledgeBaseOptions
  );
  /** @deprecated Use the options object overload instead. */
  constructor(
    name: string,
    documentStorage: DocumentTabularStorage,
    chunkStorage: ChunkVectorStorage,
    title?: string,
    description?: string
  );
  constructor(
    name: string,
    documentStorage: DocumentTabularStorage,
    chunkStorage: ChunkVectorStorage,
    titleOrOptions?: string | KnowledgeBaseOptions,
    description?: string
  ) {
    this.name = name;
    this.tabularStorage = documentStorage;
    this.chunkStorage = chunkStorage;

    if (typeof titleOrOptions === "object" && titleOrOptions !== null) {
      this.title = titleOrOptions.title ?? name;
      this.description = titleOrOptions.description ?? "";
      this.onDocumentUpsert = titleOrOptions.onDocumentUpsert;
      this.onDocumentDelete = titleOrOptions.onDocumentDelete;
      this.onSearch = titleOrOptions.onSearch;
    } else {
      this.title = titleOrOptions ?? name;
      this.description = description ?? "";
      this.onDocumentUpsert = undefined;
      this.onDocumentDelete = undefined;
      this.onSearch = undefined;
    }
  }

  // ===========================================================================
  // Document CRUD
  // ===========================================================================

  /**
   * Upsert a document.
   * @returns The document with the generated doc_id if it was auto-generated
   */
  async upsertDocument(document: Document): Promise<Document> {
    const serialized = JSON.stringify(document.toJSON());

    const insertEntity: InsertDocumentStorageEntity = {
      doc_id: document.doc_id,
      data: serialized,
    };
    const entity = await this.tabularStorage.put(insertEntity);

    if (document.doc_id !== entity.doc_id) {
      document.setDocId(entity.doc_id);
    }

    if (this.onDocumentUpsert) {
      await this.onDocumentUpsert(this, document);
    }

    return document;
  }

  /**
   * Get a document by ID
   */
  async getDocument(doc_id: string): Promise<Document | undefined> {
    const entity = await this.tabularStorage.get({ doc_id });
    if (!entity) {
      return undefined;
    }
    return Document.fromJSON(entity.data, entity.doc_id);
  }

  /**
   * Delete a document and all its chunks (cascading delete).
   */
  async deleteDocument(doc_id: string): Promise<void> {
    await this.deleteChunksForDocument(doc_id);
    await this.tabularStorage.delete({ doc_id });

    if (this.onDocumentDelete) {
      await this.onDocumentDelete(this, doc_id);
    }
  }

  /**
   * List all document IDs
   */
  async listDocuments(): Promise<string[]> {
    const entities = await this.tabularStorage.getAll();
    if (!entities) {
      return [];
    }
    return entities.map((e: DocumentStorageEntity) => e.doc_id);
  }

  // ===========================================================================
  // Tree traversal
  // ===========================================================================

  /**
   * Get a specific node by ID from a document
   */
  async getNode(doc_id: string, nodeId: string): Promise<DocumentNode | undefined> {
    const doc = await this.getDocument(doc_id);
    if (!doc) {
      return undefined;
    }

    const traverse = (node: DocumentNode): DocumentNode | undefined => {
      if (node.nodeId === nodeId) {
        return node;
      }
      if ("children" in node && Array.isArray(node.children)) {
        for (const child of node.children) {
          const found = traverse(child);
          if (found) return found;
        }
      }
      return undefined;
    };

    return traverse(doc.root);
  }

  /**
   * Get ancestors of a node (from root to target node)
   */
  async getAncestors(doc_id: string, nodeId: string): Promise<DocumentNode[]> {
    const doc = await this.getDocument(doc_id);
    if (!doc) {
      return [];
    }

    const path: string[] = [];
    const findPath = (node: DocumentNode): boolean => {
      path.push(node.nodeId);
      if (node.nodeId === nodeId) {
        return true;
      }
      if ("children" in node && Array.isArray(node.children)) {
        for (const child of node.children) {
          if (findPath(child)) {
            return true;
          }
        }
      }
      path.pop();
      return false;
    };

    if (!findPath(doc.root)) {
      return [];
    }

    const ancestors: DocumentNode[] = [];
    let currentNode: DocumentNode = doc.root;
    ancestors.push(currentNode);

    for (let i = 1; i < path.length; i++) {
      const targetId = path[i];
      if ("children" in currentNode && Array.isArray(currentNode.children)) {
        const found = currentNode.children.find((child: DocumentNode) => child.nodeId === targetId);
        if (found) {
          currentNode = found;
          ancestors.push(currentNode);
        } else {
          break;
        }
      } else {
        break;
      }
    }

    return ancestors;
  }

  // ===========================================================================
  // Chunk CRUD
  // ===========================================================================

  /**
   * Upsert a single chunk vector entity
   */
  async upsertChunk(chunk: InsertChunkVectorEntity): Promise<ChunkVectorEntity> {
    const expected = this.getVectorDimensions();
    if (expected > 0 && chunk.vector.length !== expected) {
      throw new Error(
        `Vector dimension mismatch: expected ${expected}, got ${chunk.vector.length}.`
      );
    }
    return this.chunkStorage.put(chunk);
  }

  /**
   * Upsert multiple chunk vector entities
   */
  async upsertChunksBulk(chunks: InsertChunkVectorEntity[]): Promise<ChunkVectorEntity[]> {
    const expected = this.getVectorDimensions();
    if (expected > 0) {
      for (const chunk of chunks) {
        if (chunk.vector.length !== expected) {
          throw new Error(
            `Vector dimension mismatch: expected ${expected}, got ${chunk.vector.length}.`
          );
        }
      }
    }
    return this.chunkStorage.putBulk(chunks);
  }

  /**
   * Delete all chunks for a specific document
   */
  async deleteChunksForDocument(doc_id: string): Promise<void> {
    await this.chunkStorage.deleteSearch({ doc_id });
  }

  /**
   * Get all chunks for a specific document
   */
  async getChunksForDocument(doc_id: string): Promise<ChunkVectorEntity[]> {
    const results = await this.chunkStorage.query({ doc_id });
    return (results ?? []) as ChunkVectorEntity[];
  }

  // ===========================================================================
  // Search
  // ===========================================================================

  /**
   * Search for similar chunks using vector similarity. This is the canonical
   * scope-aware entry point — subclasses (e.g. a scoped KB that isolates by
   * tenant) override this to inject filter predicates before delegating to
   * the underlying storage.
   */
  async similaritySearch(
    query: TypedArray,
    options?: VectorSearchOptions<ChunkRecord>
  ): Promise<ChunkSearchResult[]> {
    return this.chunkStorage.similaritySearch(query, options);
  }

  /**
   * Hybrid search combining vector similarity and full-text search. Canonical
   * scope-aware entry point; subclasses override for filter injection.
   *
   * @throws Error if the configured storage backend does not support hybrid search.
   */
  async hybridSearch(
    query: TypedArray,
    options: HybridSearchOptions<ChunkRecord>
  ): Promise<ChunkSearchResult[]> {
    if (typeof this.chunkStorage.hybridSearch !== "function") {
      throw new Error(
        "Hybrid search is not supported by the configured chunk storage backend. " +
          "Please use a vector storage implementation that provides `hybridSearch`."
      );
    }
    return this.chunkStorage.hybridSearch(query, options);
  }

  /**
   * Check if the configured storage backend supports hybrid search.
   */
  supportsHybridSearch(): boolean {
    return typeof this.chunkStorage.hybridSearch === "function";
  }

  /**
   * High-level text search. Delegates to the `onSearch` callback, which is
   * responsible for embedding the query and executing the appropriate search
   * (similarity, hybrid, keyword, etc.). Install `onSearch` via
   * `createKnowledgeBase({ onSearch })` or the KnowledgeBase constructor options.
   *
   * If `onSearch` calls back into `kb.similaritySearch()` / `kb.hybridSearch()`,
   * those calls still go through virtual dispatch — so subclass filter injection
   * (e.g. tenant scope) applies even when the entry point is `kb.search()`.
   *
   * @throws Error if `onSearch` is not configured.
   */
  async search(query: string, options?: ISearchOptions): Promise<ChunkSearchResult[]> {
    if (!this.onSearch) {
      throw new Error(
        "KnowledgeBase.search() requires an `onSearch` callback. " +
          "Pass one via createKnowledgeBase({ onSearch }) or the KnowledgeBase " +
          "constructor options. For raw vector search, use " +
          "`kb.similaritySearch()` or `kb.vectorStorage.similaritySearch()` directly."
      );
    }
    return this.onSearch(this, query, options);
  }

  // ===========================================================================
  // Accessors for raw storage
  // ===========================================================================

  /**
   * The underlying chunk/vector storage. Use when you need raw, unscoped
   * access to low-level vector operations — e.g. bulk maintenance, metrics,
   * or behavior that explicitly should bypass any subclass scoping. For
   * normal search, prefer `kb.similaritySearch()` / `kb.hybridSearch()`,
   * which subclasses can override to inject scope.
   */
  get vectorStorage(): ChunkVectorStorage {
    return this.chunkStorage;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Prepare a document for re-indexing: deletes all chunks but keeps the document.
   * @returns The document if found, undefined otherwise
   */
  async prepareReindex(doc_id: string): Promise<Document | undefined> {
    const doc = await this.getDocument(doc_id);
    if (!doc) {
      return undefined;
    }
    await this.deleteChunksForDocument(doc_id);
    return doc;
  }

  /**
   * Setup the underlying databases
   */
  async setupDatabase(): Promise<void> {
    await this.tabularStorage.setupDatabase();
    await this.chunkStorage.setupDatabase();
  }

  /**
   * Destroy storage instances
   */
  destroy(): void {
    this.tabularStorage.destroy();
    this.chunkStorage.destroy();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.destroy();
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  // ===========================================================================
  // Accessors
  // ===========================================================================

  /**
   * Get a chunk by ID
   */
  async getChunk(chunk_id: string): Promise<ChunkVectorEntity | undefined> {
    return this.chunkStorage.get({ chunk_id });
  }

  /**
   * Store a single chunk (alias for upsertChunk)
   */
  async put(chunk: InsertChunkVectorEntity): Promise<ChunkVectorEntity> {
    return this.chunkStorage.put(chunk);
  }

  /**
   * Store multiple chunks (alias for upsertChunksBulk)
   */
  async putBulk(chunks: InsertChunkVectorEntity[]): Promise<ChunkVectorEntity[]> {
    return this.chunkStorage.putBulk(chunks);
  }

  /**
   * Get all chunks
   */
  async getAllChunks(): Promise<ChunkVectorEntity[] | undefined> {
    return this.chunkStorage.getAll() as Promise<ChunkVectorEntity[] | undefined>;
  }

  /**
   * Get chunk count
   */
  async chunkCount(): Promise<number> {
    return this.chunkStorage.size();
  }

  /**
   * Clear all chunks
   */
  async clearChunks(): Promise<void> {
    return this.chunkStorage.deleteAll();
  }

  /**
   * Get vector dimensions
   */
  getVectorDimensions(): number {
    return this.chunkStorage.getVectorDimensions();
  }

  // ===========================================================================
  // Document chunk helpers
  // ===========================================================================

  /**
   * Get chunks from the document JSON (not from vector storage)
   */
  async getDocumentChunks(doc_id: string): Promise<ChunkRecord[]> {
    const doc = await this.getDocument(doc_id);
    if (!doc) {
      return [];
    }
    return doc.getChunks();
  }

  /**
   * Find chunks in document JSON that contain a specific nodeId in their path
   */
  async findChunksByNodeId(doc_id: string, nodeId: string): Promise<ChunkRecord[]> {
    const doc = await this.getDocument(doc_id);
    if (!doc) {
      return [];
    }
    return doc.findChunksByNodeId(nodeId);
  }
}
