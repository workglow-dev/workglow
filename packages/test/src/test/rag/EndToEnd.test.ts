/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { hierarchicalChunker } from "@workglow/ai";
import {
  Document,
  DocumentChunk,
  DocumentChunkDataset,
  DocumentChunkPrimaryKey,
  DocumentChunkSchema,
  DocumentDataset,
  DocumentStorageKey,
  DocumentStorageSchema,
  StructuralParser,
} from "@workglow/dataset";
import { InMemoryTabularStorage, InMemoryVectorStorage } from "@workglow/storage";
import { uuid4 } from "@workglow/util";
import { beforeAll, describe, expect, it } from "vitest";
import { registerTasks } from "../../binding/RegisterTasks";

describe("End-to-end hierarchical RAG", () => {
  beforeAll(async () => {
    registerTasks();
  });

  it("should demonstrate chainable design (chunks → text array)", async () => {
    // Sample markdown document
    const markdown = `# Machine Learning

Machine learning is AI.

## Supervised Learning

Uses labeled data.

## Unsupervised Learning

Finds patterns in data.`;

    // Parse into hierarchical tree
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "ML Guide");

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
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(root, { title: "Test" }, [], doc_id);

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
    const tabularStorage = new InMemoryTabularStorage<DocumentStorageSchema, DocumentStorageKey>(
      DocumentStorageSchema,
      DocumentStorageKey
    );
    await tabularStorage.setupDatabase();

    const storage = new InMemoryVectorStorage<
      typeof DocumentChunkSchema,
      typeof DocumentChunkPrimaryKey,
      Record<string, unknown>,
      Float32Array,
      DocumentChunk
    >(DocumentChunkSchema, DocumentChunkPrimaryKey, [], 3, Float32Array);
    await storage.setupDatabase();
    const vectorDataset = new DocumentChunkDataset(storage);

    const docRepo = new DocumentDataset(tabularStorage, storage);

    // Create document with enriched hierarchy
    const markdown = `# Guide

## Section 1

Content about topic A.

## Section 2

Content about topic B.`;

    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Guide");

    const doc = new Document(root, { title: "Guide" });
    const inserted = await docRepo.upsert(doc);

    // Enrich (in real workflow this would use DocumentEnricherTask)
    // For test, manually add enrichment
    const enrichedRoot = {
      ...root,
      enrichment: {
        summary: "A guide covering two sections",
      },
    };

    const enrichedDoc = new Document(enrichedRoot as any, doc.metadata, [], inserted.doc_id);
    await docRepo.upsert(enrichedDoc);

    // Generate chunks using workflow (without embedding to avoid model requirement)
    const chunkResult = await hierarchicalChunker({
      doc_id: inserted.doc_id!,
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
    const retrieved = await docRepo.getChunks(inserted.doc_id!);
    expect(retrieved).toBeDefined();
    expect(retrieved.length).toBe(chunkResult.count);
  });
});
