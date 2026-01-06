/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Document,
  hierarchicalChunker,
  NodeIdGenerator,
  StructuralParser,
} from "@workglow/ai";
import { InMemoryDocumentRepository } from "@workglow/storage";
import { describe, expect, it } from "vitest";

describe("End-to-end hierarchical RAG", () => {
  it("should demonstrate chainable design (chunks → text array)", async () => {
    // Sample markdown document
    const markdown = `# Machine Learning

Machine learning is AI.

## Supervised Learning

Uses labeled data.

## Unsupervised Learning

Finds patterns in data.`;

    // Parse into hierarchical tree
    const docId = await NodeIdGenerator.generateDocId("ml-guide", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "ML Guide");

    // CHAINABLE DESIGN TEST - Use workflow to verify chaining
    const chunkResult = await hierarchicalChunker({
      docId,
      documentTree: root,
      maxTokens: 256,
      overlap: 25,
      strategy: "hierarchical",
    });

    // Verify outputs are ready for next task in chain
    expect(chunkResult.chunks).toBeDefined();
    expect(chunkResult.text).toBeDefined();
    expect(chunkResult.count).toBe(chunkResult.text.length);
    expect(chunkResult.count).toBe(chunkResult.chunks.length);

    // The text array can be directly consumed by TextEmbeddingTask
    expect(Array.isArray(chunkResult.text)).toBe(true);
    expect(chunkResult.text.every((t) => typeof t === "string")).toBe(true);
  });

  it("should manage document chunks", async () => {
    const markdown = "# Test Document\n\nThis is test content.";
    const docId = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Test");

    const masterDoc = new Document(docId, root, { title: "Test" });

    const chunks = [
      {
        chunkId: "chunk_1",
        docId,
        text: "Test chunk 1",
        nodePath: [root.nodeId],
        depth: 1,
      },
    ];

    masterDoc.setChunks(chunks);

    // Verify chunks are stored
    const retrievedChunks = masterDoc.getChunks();
    expect(retrievedChunks.length).toBe(1);
    expect(retrievedChunks[0].text).toBe("Test chunk 1");
  });

  it("should demonstrate document repository integration", async () => {
    const docRepo = new InMemoryDocumentRepository();
    await docRepo.setupDatabase();

    // Create document with enriched hierarchy
    const markdown = `# Guide

## Section 1

Content about topic A.

## Section 2

Content about topic B.`;

    const docId = await NodeIdGenerator.generateDocId("guide", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Guide");

    const masterDoc = new Document(docId, root, { title: "Guide" });

    // Enrich (in real workflow this would use DocumentEnricherTask)
    // For test, manually add enrichment
    const enrichedRoot = {
      ...root,
      enrichment: {
        summary: "A guide covering two sections",
      },
    };

    const enrichedDoc = new Document(docId, enrichedRoot as any, masterDoc.metadata);
    await docRepo.upsert(enrichedDoc);

    // Generate chunks using workflow (without embedding to avoid model requirement)
    const chunkResult = await hierarchicalChunker({
      docId,
      documentTree: enrichedRoot,
      maxTokens: 256,
      overlap: 25,
      strategy: "hierarchical",
    });
    expect(chunkResult.count).toBeGreaterThan(0);

    // Add chunks to document
    enrichedDoc.setChunks(chunkResult.chunks);
    await docRepo.upsert(enrichedDoc);

    // Verify chunks were stored
    const retrieved = await docRepo.getChunks(docId);
    expect(retrieved).toBeDefined();
    expect(retrieved.length).toBe(chunkResult.count);
  });
});
