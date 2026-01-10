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
  public readonly docId: string;
  public readonly metadata: DocumentMetadata;
  public readonly root: DocumentNode;
  private chunks: ChunkNode[];

  constructor(
    docId: string,
    root: DocumentNode,
    metadata: DocumentMetadata,
    chunks: ChunkNode[] = []
  ) {
    this.docId = docId;
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
   * Find chunks by nodeId
   */
  findChunksByNodeId(nodeId: string): ChunkNode[] {
    return this.chunks.filter((chunk) => chunk.nodePath.includes(nodeId));
  }

  /**
   * Serialize to JSON
   */
  toJSON(): {
    docId: string;
    metadata: DocumentMetadata;
    root: DocumentNode;
    chunks: ChunkNode[];
  } {
    return {
      docId: this.docId,
      metadata: this.metadata,
      root: this.root,
      chunks: this.chunks,
    };
  }

  /**
   * Deserialize from JSON
   */
  static fromJSON(json: string): Document {
    const obj = JSON.parse(json);
    const doc = new Document(obj.docId, obj.root, obj.metadata, obj.chunks);
    return doc;
  }
}
