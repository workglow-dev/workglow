/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  deriveConfigId,
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

    // Verify provenance for configId derivation
    const provenance = {
      embeddingModel: "test-model",
      chunkerStrategy: "hierarchical",
      maxTokens: 256,
      overlap: 25,
    };

    const configId = await deriveConfigId(provenance);
    expect(configId).toMatch(/^cfg_[0-9a-f]{16}$/);
  });

  it("should support variant comparison", async () => {
    const markdown = "# Test Document\n\nThis is test content.";
    const docId = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Test");

    const masterDoc = new Document(docId, root, { title: "Test" });

    // Create two variants with different configs
    const prov1 = {
      embeddingModel: "model-1",
      chunkerStrategy: "hierarchical",
      maxTokens: 512,
      overlap: 50,
    };

    const prov2 = {
      embeddingModel: "model-2",
      chunkerStrategy: "flat",
      maxTokens: 256,
      overlap: 25,
    };

    const chunks1 = [
      {
        chunkId: "chunk_1",
        docId,
        configId: await deriveConfigId(prov1),
        text: "Test chunk 1",
        nodePath: [root.nodeId],
        depth: 1,
      },
    ];

    const chunks2 = [
      {
        chunkId: "chunk_2",
        docId,
        configId: await deriveConfigId(prov2),
        text: "Test chunk 2",
        nodePath: [root.nodeId],
        depth: 1,
      },
    ];

    const configId1 = await masterDoc.addVariant(prov1, chunks1);
    const configId2 = await masterDoc.addVariant(prov2, chunks2);

    // Verify both variants are tracked
    expect(masterDoc.hasVariant(configId1)).toBe(true);
    expect(masterDoc.hasVariant(configId2)).toBe(true);

    // Verify they have different configIds
    expect(configId1).not.toBe(configId2);

    // Verify we can retrieve both
    const variant1 = masterDoc.getVariant(configId1);
    const variant2 = masterDoc.getVariant(configId2);

    expect(variant1?.provenance.embeddingModel).toBe("model-1");
    expect(variant2?.provenance.embeddingModel).toBe("model-2");
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

    // Add variant to document
    const provenance = {
      embeddingModel: "test-model",
      chunkerStrategy: "hierarchical",
      maxTokens: 256,
      overlap: 25,
    };

    const configId = await enrichedDoc.addVariant(provenance, chunkResult.chunks);
    await docRepo.upsert(enrichedDoc);

    // Verify variant was stored
    const retrieved = await docRepo.getVariant(docId, configId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.chunks.length).toBe(chunkResult.count);
  });
});
