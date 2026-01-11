/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { hierarchicalChunker } from "@workglow/ai";
import {
  Document,
  DocumentRepository,
  DocumentStorageKey,
  DocumentStorageSchema,
  InMemoryDocumentNodeVectorRepository,
  InMemoryTabularRepository,
  NodeIdGenerator,
  StructuralParser,
} from "@workglow/storage";
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
    const doc_id = await NodeIdGenerator.generateDocId("ml-guide", markdown);
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "ML Guide");

    // CHAINABLE DESIGN TEST - Use workflow to verify chaining
    const chunkResult = await hierarchicalChunker({
      doc_id,
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
    const doc_id = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });

    const chunks = [
      {
        chunkId: "chunk_1",
        doc_id: doc_id,
        text: "Test chunk 1",
        nodePath: [root.nodeId],
        depth: 1,
      },
    ];

    doc.setChunks(chunks);

    // Verify chunks are stored
    const retrievedChunks = doc.getChunks();
    expect(retrievedChunks.length).toBe(1);
    expect(retrievedChunks[0].text).toBe("Test chunk 1");
  });

  it("should demonstrate document repository integration", async () => {
    const tabularStorage = new InMemoryTabularRepository<DocumentStorageSchema, DocumentStorageKey>(
      DocumentStorageSchema,
      DocumentStorageKey
    );
    await tabularStorage.setupDatabase();

    const vectorStorage = new InMemoryDocumentNodeVectorRepository(3);
    await vectorStorage.setupDatabase();

    const docRepo = new DocumentRepository(tabularStorage, vectorStorage);

    // Create document with enriched hierarchy
    const markdown = `# Guide

## Section 1

Content about topic A.

## Section 2

Content about topic B.`;

    const doc_id = await NodeIdGenerator.generateDocId("guide", markdown);
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Guide");

    const doc = new Document(doc_id, root, { title: "Guide" });

    // Enrich (in real workflow this would use DocumentEnricherTask)
    // For test, manually add enrichment
    const enrichedRoot = {
      ...root,
      enrichment: {
        summary: "A guide covering two sections",
      },
    };

    const enrichedDoc = new Document(doc_id, enrichedRoot as any, doc.metadata);
    await docRepo.upsert(enrichedDoc);

    // Generate chunks using workflow (without embedding to avoid model requirement)
    const chunkResult = await hierarchicalChunker({
      doc_id,
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
    const retrieved = await docRepo.getChunks(doc_id);
    expect(retrieved).toBeDefined();
    expect(retrieved.length).toBe(chunkResult.count);
  });
});
