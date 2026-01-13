/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { sha256 } from "@workglow/util";

import {
  NodeKind,
  type DocumentNode,
  type DocumentRootNode,
  type NodeKind as NodeKindType,
  type NodeRange,
  type SectionNode,
  type TopicNode,
} from "./DocumentSchema";

/**
 * Utility functions for ID generation
 */
export class NodeIdGenerator {
  /**
   * Generate doc_id from source URI and content hash
   */
  static async generateDocId(sourceUri: string, content: string): Promise<string> {
    const contentHash = await sha256(content);
    const combined = `${sourceUri}|${contentHash}`;
    const hash = await sha256(combined);
    return `doc_${hash.substring(0, 16)}`;
  }

  /**
   * Generate nodeId for structural nodes (document, section)
   */
  static async generateStructuralNodeId(
    doc_id: string,
    kind: NodeKindType,
    range: NodeRange
  ): Promise<string> {
    const combined = `${doc_id}|${kind}|${range.startOffset}:${range.endOffset}`;
    const hash = await sha256(combined);
    return `node_${hash.substring(0, 16)}`;
  }

  /**
   * Generate nodeId for child nodes (paragraph, topic)
   */
  static async generateChildNodeId(parentNodeId: string, ordinal: number): Promise<string> {
    const combined = `${parentNodeId}|${ordinal}`;
    const hash = await sha256(combined);
    return `node_${hash.substring(0, 16)}`;
  }

  /**
   * Generate chunkId
   */
  static async generateChunkId(
    doc_id: string,
    leafNodeId: string,
    chunkOrdinal: number
  ): Promise<string> {
    const combined = `${doc_id}|${leafNodeId}|${chunkOrdinal}`;
    const hash = await sha256(combined);
    return `chunk_${hash.substring(0, 16)}`;
  }
}

/**
 * Approximate token counting (v1)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Helper to check if a node has children
 */
export function hasChildren(
  node: DocumentNode
): node is DocumentRootNode | SectionNode | TopicNode {
  return (
    node.kind === NodeKind.DOCUMENT ||
    node.kind === NodeKind.SECTION ||
    node.kind === NodeKind.TOPIC
  );
}

/**
 * Helper to get all children of a node
 */
export function getChildren(node: DocumentNode): DocumentNode[] {
  if (hasChildren(node)) {
    return node.children;
  }
  return [];
}

/**
 * Traverse document tree depth-first
 */
export function* traverseDepthFirst(node: DocumentNode): Generator<DocumentNode> {
  yield node;
  if (hasChildren(node)) {
    for (const child of node.children) {
      yield* traverseDepthFirst(child);
    }
  }
}

/**
 * Get node path from root to target node
 */
export function getNodePath(root: DocumentNode, targetNodeId: string): string[] | undefined {
  const path: string[] = [];

  function search(node: DocumentNode): boolean {
    path.push(node.nodeId);
    if (node.nodeId === targetNodeId) {
      return true;
    }
    if (hasChildren(node)) {
      for (const child of node.children) {
        if (search(child)) {
          return true;
        }
      }
    }
    path.pop();
    return false;
  }

  return search(root) ? path : undefined;
}

/**
 * Get document range for a node path
 */
export function getDocumentRange(root: DocumentNode, nodePath: string[]): NodeRange {
  let currentNode = root as DocumentRootNode | SectionNode | TopicNode;

  // Start from index 1 since nodePath[0] is the root
  for (let i = 1; i < nodePath.length; i++) {
    const targetId = nodePath[i];
    const children = currentNode.children;
    let found: DocumentNode | undefined;

    for (let j = 0; j < children.length; j++) {
      if (children[j].nodeId === targetId) {
        found = children[j];
        break;
      }
    }

    if (!found) {
      throw new Error(`Node with id ${targetId} not found in path`);
    }

    currentNode = found as DocumentRootNode | SectionNode | TopicNode;
  }

  return currentNode.range;
}
