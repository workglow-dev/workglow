/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Provenance } from "@workglow/task-graph";
import type { ChunkNode, DocumentNode } from "./DocumentSchema";
import {
  type DocumentMetadata,
  type VariantManifest,
  type VariantProvenance,
} from "./DocumentSchema";
import { deriveConfigId, extractConfigFields } from "./ProvenanceUtils";

/**
 * Document represents a hierarchical document with multiple processing variants
 *
 * Key features:
 * - Single source-of-truth tree structure (root node)
 * - Multiple chunking/embedding variants keyed by provenance-derived configId
 * - Separate persistence for document structure vs vectors
 */
export class Document {
  public readonly docId: string;
  public readonly metadata: DocumentMetadata;
  public readonly root: DocumentNode;
  private readonly variants: Map<string, VariantManifest>;

  constructor(docId: string, root: DocumentNode, metadata: DocumentMetadata) {
    this.docId = docId;
    this.root = root;
    this.metadata = metadata;
    this.variants = new Map();
  }

  /**
   * Add a processing variant
   */
  async addVariant(
    provenance: Provenance | VariantProvenance,
    chunks: ChunkNode[]
  ): Promise<string> {
    const configId = await deriveConfigId(provenance);

    // Use extractConfigFields for type-safe field extraction
    const variantProvenance = Array.isArray(provenance)
      ? extractConfigFields(provenance)
      : (provenance as VariantProvenance);

    const manifest: VariantManifest = {
      configId,
      provenance: variantProvenance,
      createdAt: new Date().toISOString(),
      chunks,
    };

    this.variants.set(configId, manifest);
    return configId;
  }

  /**
   * Get a variant by configId
   */
  getVariant(configId: string): VariantManifest | undefined {
    return this.variants.get(configId);
  }

  /**
   * Get all variants
   */
  getAllVariants(): VariantManifest[] {
    return Array.from(this.variants.values());
  }

  /**
   * Check if a variant exists
   */
  hasVariant(configId: string): boolean {
    return this.variants.has(configId);
  }

  /**
   * Get all configIds
   */
  getConfigIds(): string[] {
    return Array.from(this.variants.keys());
  }

  /**
   * Find chunks by nodeId across all variants
   */
  findChunksByNodeId(nodeId: string): Array<{ configId: string; chunk: ChunkNode }> {
    const results: Array<{ configId: string; chunk: ChunkNode }> = [];

    for (const [configId, manifest] of this.variants) {
      for (const chunk of manifest.chunks) {
        if (chunk.nodePath.includes(nodeId)) {
          results.push({ configId, chunk });
        }
      }
    }

    return results;
  }

  /**
   * Get chunks for a specific variant
   */
  getChunks(configId: string): ChunkNode[] {
    const variant = this.variants.get(configId);
    return variant?.chunks ?? [];
  }

  /**
   * Serialize to JSON
   */
  toJSON(): {
    docId: string;
    metadata: DocumentMetadata;
    root: DocumentNode;
    variants: VariantManifest[];
  } {
    return {
      docId: this.docId,
      metadata: this.metadata,
      root: this.root,
      variants: Array.from(this.variants.values()),
    };
  }

  /**
   * Deserialize from JSON
   */
  static fromJSON(json: {
    docId: string;
    metadata: DocumentMetadata;
    root: DocumentNode;
    variants: VariantManifest[];
  }): Document {
    const doc = new Document(json.docId, json.root, json.metadata);
    for (const variant of json.variants) {
      doc.variants.set(variant.configId, variant);
    }
    return doc;
  }
}
