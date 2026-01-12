/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { HierarchicalChunkerTaskOutput } from "@workglow/ai";
import { ChunkNode, InMemoryChunkVectorRepository, NodeIdGenerator } from "@workglow/storage";
import { Workflow } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

describe("Complete chainable workflow", () => {
  it("should chain from parsing to storage without loops", async () => {
    const vectorRepo = new InMemoryChunkVectorRepository(3);
    await vectorRepo.setupDatabase();

    const markdown = `# Test Document

## Section 1

This is the first section with some content.

## Section 2

This is the second section with more content.`;

    // Parse → Enrich → Chunk
    const result = await new Workflow()
      .structuralParser({
        text: markdown,
        title: "Test Doc",
        format: "markdown",
        sourceUri: "test.md",
      })
      .documentEnricher({
        generateSummaries: true,
        extractEntities: true,
      })
      .hierarchicalChunker({
        maxTokens: 256,
        overlap: 25,
        strategy: "hierarchical",
      })
      .run();

    // Verify the chain worked - final output from hierarchicalChunker
    expect(result.doc_id).toBeDefined();
    expect(result.doc_id).toMatch(/^doc_[0-9a-f]{16}$/);
    expect(result.chunks).toBeDefined();
    expect(result.text).toBeDefined();
    expect(result.count).toBeGreaterThan(0);

    // Verify output structure matches expectations
    expect(result.chunks.length).toBe(result.count);
    expect(result.text.length).toBe(result.count);
  });

  it("should demonstrate data flow through chain", async () => {
    const markdown = "# Title\n\nParagraph content.";

    const result = await new Workflow()
      .structuralParser({
        text: markdown,
        title: "Test",
        format: "markdown",
      })
      .hierarchicalChunker({
        maxTokens: 512,
        overlap: 50,
        strategy: "hierarchical",
      })
      .run();

    // Verify data flows correctly (final output from hierarchicalChunker)
    expect(result.doc_id).toBeDefined();
    expect(result.chunks).toBeDefined();
    expect(result.text).toBeDefined();

    // doc_id should flow through the chain to all chunks
    // PropertyArrayGraphResult makes chunks potentially an array of arrays
    const chunks = (
      Array.isArray(result.chunks) && result.chunks.length > 0
        ? Array.isArray(result.chunks[0])
          ? result.chunks.flat()
          : result.chunks
        : []
    ) as ChunkNode[];
    for (const chunk of chunks) {
      expect(chunk.doc_id).toBe(result.doc_id);
    }
  });

  it("should generate consistent doc_id across chains", async () => {
    const markdown = "# Test\n\nContent.";

    // Run twice with same content
    const result1 = await new Workflow()
      .structuralParser({
        text: markdown,
        title: "Test",
        sourceUri: "test.md",
      })
      .run();

    const result2 = await new Workflow()
      .structuralParser({
        text: markdown,
        title: "Test",
        sourceUri: "test.md",
      })
      .run();

    // Should generate same doc_id (deterministic)
    expect(result1.doc_id).toBe(result2.doc_id);
  });

  it("should allow doc_id override for variant creation", async () => {
    const markdown = "# Test\n\nContent.";
    const customId = await NodeIdGenerator.generateDocId("custom", markdown);

    const result = (await new Workflow()
      .structuralParser({
        text: markdown,
        title: "Test",
        doc_id: customId, // Override with custom ID
      })
      .hierarchicalChunker({
        maxTokens: 512,
      })
      .run()) as HierarchicalChunkerTaskOutput;

    // Should use the provided ID
    expect(result.doc_id).toBe(customId);

    // All chunks should reference it
    for (const chunk of result.chunks) {
      expect(chunk.doc_id).toBe(customId);
    }
  });
});
