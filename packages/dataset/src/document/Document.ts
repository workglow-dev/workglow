/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChunkNode, DocumentMetadata, DocumentNode } from "./DocumentSchema";

/**
 * Document represents a hierarchical document with chunks
 *
 * Key features:
 * - Single source-of-truth tree structure (root node)
 * - Single set of chunks
 * - Separate persistence for document structure vs vectors
 */
export class Document {
  public doc_id: string | undefined;
  public readonly metadata: DocumentMetadata;
  public readonly root: DocumentNode;
  private chunks: ChunkNode[];

  constructor(
    root: DocumentNode,
    metadata: DocumentMetadata,
    chunks: ChunkNode[] = [],
    doc_id?: string
  ) {
    this.doc_id = doc_id;
    this.root = root;
    this.metadata = metadata;
    this.chunks = chunks || [];
  }

  /**
   * Set chunks for the document
   */
  setChunks(chunks: ChunkNode[]): void {
    this.chunks = chunks;
  }

  /**
   * Get all chunks
   */
  getChunks(): ChunkNode[] {
    return this.chunks;
  }

  /**
   * Set the document ID
   */
  setDocId(doc_id: string): void {
    this.doc_id = doc_id;
  }

  /**
   * Find chunks by nodeId
   */
  findChunksByNodeId(nodeId: string): ChunkNode[] {
    return this.chunks.filter((chunk) => chunk.nodePath.includes(nodeId));
  }

  /**
   * Serialize to JSON
   */
  toJSON(): {
    metadata: DocumentMetadata;
    root: DocumentNode;
    chunks: ChunkNode[];
  } {
    return {
      metadata: this.metadata,
      root: this.root,
      chunks: this.chunks,
    };
  }

  /**
   * Deserialize from JSON
   */
  static fromJSON(json: string, doc_id?: string): Document {
    const obj = JSON.parse(json);
    return new Document(obj.root, obj.metadata, obj.chunks, doc_id);
  }

}
