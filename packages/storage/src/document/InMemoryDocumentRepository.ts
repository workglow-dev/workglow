/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDocumentRepository } from "./IDocumentRepository";

/**
 * In-memory implementation of document repository
 */
export class InMemoryDocumentRepository implements IDocumentRepository {
  private documents: Map<string, any> = new Map();

  async setupDatabase(): Promise<void> {
    // No setup needed for in-memory
  }

  async upsert(document: any): Promise<void> {
    this.documents.set(document.docId, document);
  }

  async get(docId: string): Promise<any | undefined> {
    return this.documents.get(docId);
  }

  async delete(docId: string): Promise<void> {
    this.documents.delete(docId);
  }

  async getNode(docId: string, nodeId: string): Promise<any | undefined> {
    const doc = this.documents.get(docId);
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

  async getAncestors(docId: string, nodeId: string): Promise<any[]> {
    const doc = this.documents.get(docId);
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

  async getChunks(docId: string): Promise<any[]> {
    const doc = this.documents.get(docId);
    if (!doc) {
      return [];
    }
    return doc.getChunks ? doc.getChunks() : [];
  }

  async findChunksByNodeId(docId: string, nodeId: string): Promise<any[]> {
    const doc = this.documents.get(docId);
    if (!doc) {
      return [];
    }
    return doc.findChunksByNodeId ? doc.findChunksByNodeId(nodeId) : [];
  }

  async list(): Promise<string[]> {
    return Array.from(this.documents.keys());
  }

  /**
   * Clear all documents (useful for testing)
   */
  clear(): void {
    this.documents.clear();
  }

  /**
   * Get count of documents
   */
  count(): number {
    return this.documents.size;
  }
}
