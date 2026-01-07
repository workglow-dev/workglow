/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ITabularRepository,
  IVectorRepository,
  SearchResult,
  VectorSearchOptions,
} from "@workglow/storage";
import type { DataPortSchemaObject, FromSchema, TypedArray } from "@workglow/util";
import { Document } from "./Document";
import { ChunkNode, DocumentNode } from "./DocumentSchema";

/**
 * Schema for storing documents in tabular storage
 */
export const DocumentStorageSchema = {
  type: "object",
  properties: {
    docId: {
      type: "string",
      title: "Document ID",
      description: "Unique identifier for the document",
    },
    data: {
      type: "string",
      title: "Document Data",
      description: "JSON-serialized document",
    },
  },
  required: ["docId", "data"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

type DocumentStorageEntity = FromSchema<typeof DocumentStorageSchema>;

/**
 * Document repository that uses TabularStorage for persistence and VectorStorage for search.
 * This is a unified implementation that composes storage backends rather than using
 * inheritance/interface patterns.
 */
export class DocumentRepository {
  private tabularStorage: ITabularRepository<
    typeof DocumentStorageSchema,
    ["docId"],
    DocumentStorageEntity,
    { docId: string },
    Document
  >;
  private vectorStorage?: IVectorRepository<any, TypedArray>;

  /**
   * Creates a new DocumentRepository instance.
   *
   * @param tabularStorage - Pre-initialized tabular storage for document persistence
   * @param vectorStorage - Pre-initialized vector storage for chunk similarity search
   *
   * @example
   * ```typescript
   * const tabularStorage = new InMemoryTabularRepository(DocumentStorageSchema, ["docId"]);
   * await tabularStorage.setupDatabase();
   *
   * const vectorStorage = new InMemoryVectorRepository();
   * await vectorStorage.setupDatabase();
   *
   * const docRepo = new DocumentRepository(tabularStorage, vectorStorage);
   * ```
   */
  constructor(
    tabularStorage: ITabularRepository<
      typeof DocumentStorageSchema,
      ["docId"],
      DocumentStorageEntity,
      { docId: string },
      Document
    >,
    vectorStorage?: IVectorRepository<any, TypedArray>
  ) {
    this.tabularStorage = tabularStorage;
    this.vectorStorage = vectorStorage;
  }

  /**
   * Upsert a document
   */
  async upsert(document: Document): Promise<void> {
    const serialized = JSON.stringify(document.toJSON ? document.toJSON() : document);
    await this.tabularStorage.put({
      docId: document.docId,
      data: serialized,
    });
  }

  /**
   * Get a document by ID
   */
  async get(docId: string): Promise<Document | undefined> {
    const entity = await this.tabularStorage.get({ docId });
    if (!entity) {
      return undefined;
    }
    return Document.fromJSON(entity.data);
  }

  /**
   * Delete a document
   */
  async delete(docId: string): Promise<void> {
    await this.tabularStorage.delete({ docId });
  }

  /**
   * Get a specific node by ID
   */
  async getNode(docId: string, nodeId: string): Promise<DocumentNode | undefined> {
    const doc = await this.get(docId);
    if (!doc) {
      return undefined;
    }

    // Traverse tree to find node
    const traverse = (node: any): any => {
      if (node.nodeId === nodeId) {
        return node;
      }
      if (node.children && Array.isArray(node.children)) {
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
   * Get ancestors of a node (from root to node)
   */
  async getAncestors(docId: string, nodeId: string): Promise<DocumentNode[]> {
    const doc = await this.get(docId);
    if (!doc) {
      return [];
    }

    // Get path from root to target node
    const path: string[] = [];
    const findPath = (node: any): boolean => {
      path.push(node.nodeId);
      if (node.nodeId === nodeId) {
        return true;
      }
      if (node.children && Array.isArray(node.children)) {
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

    // Collect nodes along the path
    const ancestors: any[] = [];
    let currentNode: any = doc.root;
    ancestors.push(currentNode);

    for (let i = 1; i < path.length; i++) {
      const targetId = path[i];
      if (currentNode.children && Array.isArray(currentNode.children)) {
        const found = currentNode.children.find((child: any) => child.nodeId === targetId);
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

  /**
   * Get chunks for a document
   */
  async getChunks(docId: string): Promise<ChunkNode[]> {
    const doc = await this.get(docId);
    if (!doc) {
      return [];
    }
    return doc.getChunks();
  }

  /**
   * Find chunks that contain a specific nodeId in their path
   */
  async findChunksByNodeId(docId: string, nodeId: string): Promise<ChunkNode[]> {
    const doc = await this.get(docId);
    if (!doc) {
      return [];
    }
    if (doc.findChunksByNodeId) {
      return doc.findChunksByNodeId(nodeId);
    }
    // Fallback implementation
    const chunks = doc.getChunks();
    return chunks.filter((chunk) => chunk.nodePath && chunk.nodePath.includes(nodeId));
  }

  /**
   * List all document IDs
   */
  async list(): Promise<string[]> {
    const entities = await this.tabularStorage.getAll();
    if (!entities) {
      return [];
    }
    return entities.map((e) => e.docId);
  }

  /**
   * Search for similar vectors using the vector storage
   * @param query - Query vector to search for
   * @param options - Search options (topK, filter, scoreThreshold)
   * @returns Array of search results sorted by similarity
   */
  async search(
    query: TypedArray,
    options?: VectorSearchOptions<any, TypedArray>
  ): Promise<SearchResult<any, TypedArray>[]> {
    return this.vectorStorage?.similaritySearch(query, options) || [];
  }
}
