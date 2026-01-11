/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChunkNode, DocumentNode } from "@workglow/storage";
import { Document, NodeKind } from "@workglow/storage";
import { describe, expect, test } from "vitest";

describe("Document", () => {
  const createTestDocumentNode = (): DocumentNode => ({
    nodeId: "root",
    kind: NodeKind.DOCUMENT,
    range: { startOffset: 0, endOffset: 100 },
    text: "Test document stuff",
    title: "Test document",
    children: [],
  });

  const createTestChunks = (): ChunkNode[] => [
    {
      chunkId: "chunk1",
      doc_id: "doc1",
      text: "Test chunk",
      nodePath: ["root"],
      depth: 1,
    },
  ];

  test("setChunks and getChunks", () => {
    const doc = new Document("doc1", createTestDocumentNode(), { title: "Test" });

    doc.setChunks(createTestChunks());

    const chunks = doc.getChunks();
    expect(chunks).toBeDefined();
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toBe("Test chunk");
  });

  test("findChunksByNodeId", () => {
    const doc = new Document("doc1", createTestDocumentNode(), { title: "Test" });

    doc.setChunks(createTestChunks());

    const chunks = doc.findChunksByNodeId("root");
    expect(chunks).toBeDefined();
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toBe("Test chunk");
  });
});
