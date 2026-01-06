/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  estimateTokens,
  hierarchicalChunker,
  HierarchicalChunkerTask,
  NodeIdGenerator,
  StructuralParser,
} from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

describe("HierarchicalChunkerTask", () => {
  it("should chunk a simple document hierarchically", async () => {
    const markdown = `# Section 1

This is a paragraph that should fit in one chunk.

# Section 2

This is another paragraph.`;

    const docId = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Test");

    const result = await hierarchicalChunker({
      docId,
      documentTree: root,
      maxTokens: 512,
      overlap: 50,
      strategy: "hierarchical",
    });

    expect(result.chunks).toBeDefined();
    expect(result.text).toBeDefined();
    expect(result.count).toBeGreaterThan(0);
    expect(result.chunks.length).toBe(result.count);
    expect(result.text.length).toBe(result.count);

    // Each chunk should have required fields
    for (const chunk of result.chunks) {
      expect(chunk.chunkId).toBeDefined();
      expect(chunk.docId).toBe(docId);
      expect(chunk.configId).toBeDefined();
      expect(chunk.text).toBeDefined();
      expect(chunk.nodePath).toBeDefined();
      expect(chunk.nodePath.length).toBeGreaterThan(0);
      expect(chunk.depth).toBeGreaterThanOrEqual(0);
    }
  });

  it("should respect token budgets", async () => {
    // Create a long text that requires splitting
    const longText = "Lorem ipsum dolor sit amet. ".repeat(100);
    const markdown = `# Section\n\n${longText}`;

    const docId = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Long");

    const maxTokens = 100;
    const result = await hierarchicalChunker({
      docId,
      documentTree: root,
      maxTokens,
      overlap: 10,
      strategy: "hierarchical",
    });

    // Should create multiple chunks
    expect(result.count).toBeGreaterThan(1);

    // Each chunk should respect token budget
    for (const chunk of result.chunks) {
      const tokens = estimateTokens(chunk.text);
      expect(tokens).toBeLessThanOrEqual(maxTokens);
    }
  });

  it("should create overlapping chunks", async () => {
    const text = "Word ".repeat(200);
    const markdown = `# Section\n\n${text}`;

    const docId = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Overlap");

    const maxTokens = 50;
    const overlap = 10;
    const result = await hierarchicalChunker({
      docId,
      documentTree: root,
      maxTokens,
      overlap,
      strategy: "hierarchical",
    });

    // Should have multiple chunks
    expect(result.count).toBeGreaterThan(1);

    // Check for overlap in text content
    if (result.chunks.length > 1) {
      const chunk0 = result.chunks[0].text;
      const chunk1 = result.chunks[1].text;

      // Extract end of first chunk
      const chunk0End = chunk0.substring(Math.max(0, chunk0.length - 50));
      // Check if beginning of second chunk overlaps
      const hasOverlap = chunk1.includes(chunk0End.substring(0, 20));

      expect(hasOverlap).toBe(true);
    }
  });

  it("should populate provenance fields", async () => {
    const markdown = "# Test\n\nContent.";
    const docId = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Provenance");

    const task = new HierarchicalChunkerTask({
      docId,
      documentTree: root,
      maxTokens: 512,
      overlap: 50,
      strategy: "hierarchical",
    });

    const provenance = task.getProvenance();

    expect(provenance).toBeDefined();
    expect(provenance?.chunkerStrategy).toBe("hierarchical");
    expect(provenance?.maxTokens).toBe(512);
    expect(provenance?.overlap).toBe(50);
    expect(provenance?.docId).toBe(docId);
  });

  it("should handle flat strategy", async () => {
    const markdown = `# Section 1

Paragraph 1.

# Section 2

Paragraph 2.`;

    const docId = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Flat");

    const result = await new Workflow()
      .hierarchicalChunker({
        docId,
        documentTree: root,
        maxTokens: 512,
        overlap: 50,
        strategy: "flat",
      })
      .run();

    // Flat strategy should still produce chunks
    expect(result.count).toBeGreaterThan(0);
  });

  it("should maintain node paths in chunks", async () => {
    const markdown = `# Section 1

## Subsection 1.1

Paragraph content.`;

    const docId = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Paths");

    const result = await hierarchicalChunker({
      docId,
      documentTree: root,
      maxTokens: 512,
      overlap: 50,
      strategy: "hierarchical",
    });

    // Check that chunks have node paths
    for (const chunk of result.chunks) {
      expect(chunk.nodePath).toBeDefined();
      expect(Array.isArray(chunk.nodePath)).toBe(true);
      expect(chunk.nodePath.length).toBeGreaterThan(0);

      // First element should be root node ID
      expect(chunk.nodePath[0]).toBe(root.nodeId);
    }
  });
});

describe("Token estimation", () => {
  it("should estimate tokens approximately", () => {
    const text = "This is a test string";
    const tokens = estimateTokens(text);

    // Rough approximation: 1 token ~= 4 characters
    const expected = Math.ceil(text.length / 4);
    expect(tokens).toBe(expected);
  });

  it("should handle empty strings", () => {
    const tokens = estimateTokens("");
    expect(tokens).toBe(0);
  });

  it("should increase token count with text length", () => {
    const shortText = "Hello";
    const longText = "Hello world this is a much longer text";

    const shortTokens = estimateTokens(shortText);
    const longTokens = estimateTokens(longText);

    expect(longTokens).toBeGreaterThan(shortTokens);
  });
});
