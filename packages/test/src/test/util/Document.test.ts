/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChunkNode, DocumentNode } from "@workglow/ai";
import { Document, NodeKind } from "@workglow/ai";
import { describe, expect, test } from "vitest";

describe("Document", () => {
  const createTestDocumentNode = (): DocumentNode => ({
    nodeId: "root",
    kind: NodeKind.DOCUMENT,
    range: { startOffset: 0, endOffset: 100 },
    text: "Test document",
    title: "Test document",
    children: [],
  });

  const createTestChunks = (): ChunkNode[] => [
    {
      chunkId: "chunk1",
      docId: "doc1",
      configId: "cfg_test",
      text: "Test chunk",
      nodePath: ["root"],
      depth: 1,
    },
  ];

  test("addVariant with VariantProvenance", async () => {
    const doc = new Document("doc1", createTestDocumentNode(), { title: "Test" });

    const provenance = {
      embeddingModel: "text-embedding-3-small",
      chunkerStrategy: "hierarchical",
      maxTokens: 512,
      overlap: 50,
    };

    const configId = await doc.addVariant(provenance, createTestChunks());

    expect(configId).toBeDefined();
    expect(configId).toMatch(/^cfg_/);

    const variant = doc.getVariant(configId);
    expect(variant).toBeDefined();
    expect(variant?.provenance.embeddingModel).toBe("text-embedding-3-small");
    expect(variant?.provenance.chunkerStrategy).toBe("hierarchical");
    expect(variant?.provenance.maxTokens).toBe(512);
    expect(variant?.provenance.overlap).toBe(50);
  });

  test("addVariant with optional fields", async () => {
    const doc = new Document("doc1", createTestDocumentNode(), { title: "Test" });

    const provenance = {
      embeddingModel: "text-embedding-3-small",
      chunkerStrategy: "hierarchical",
      maxTokens: 512,
      overlap: 50,
      summaryModel: "gpt-4",
      nerModel: "bert-ner",
    };

    const configId = await doc.addVariant(provenance, createTestChunks());

    const variant = doc.getVariant(configId);
    expect(variant).toBeDefined();
    expect(variant?.provenance.summaryModel).toBe("gpt-4");
    expect(variant?.provenance.nerModel).toBe("bert-ner");
  });
});
