/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Type definitions to avoid circular dependency
// These types are defined in @workglow/ai but imported here as any
type ChunkNode = any;
type DocumentNode = any;
type Document = any;
type VariantManifest = any;

/**
 * Document repository interface for storing and retrieving hierarchical documents
 */
export interface IDocumentRepository {
  /**
   * Upsert a document
   */
  upsert(document: Document): Promise<void>;

  /**
   * Get a document by ID
   */
  get(docId: string): Promise<Document | undefined>;

  /**
   * Delete a document
   */
  delete(docId: string): Promise<void>;

  /**
   * Get a specific node by ID
   */
  getNode(docId: string, nodeId: string): Promise<DocumentNode | undefined>;

  /**
   * Get ancestors of a node (from root to node)
   */
  getAncestors(docId: string, nodeId: string): Promise<DocumentNode[]>;

  /**
   * Get a specific variant manifest
   */
  getVariant(docId: string, configId: string): Promise<VariantManifest | undefined>;

  /**
   * Get all variants for a document
   */
  getAllVariants(docId: string): Promise<VariantManifest[]>;

  /**
   * Get chunks by configId
   */
  getChunks(docId: string, configId: string): Promise<ChunkNode[]>;

  /**
   * Find chunks that contain a specific nodeId in their path
   */
  findChunksByNodeId(
    docId: string,
    nodeId: string
  ): Promise<Array<{ configId: string; chunk: ChunkNode }>>;

  /**
   * List all document IDs
   */
  list(): Promise<string[]>;

  /**
   * Setup/initialize the repository
   */
  setupDatabase(): Promise<void>;
}
