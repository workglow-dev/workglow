/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChunkingStrategy, textChunker } from "@workglow/ai";
import { describe, expect, test } from "vitest";

describe("TextChunkerTask", () => {
  const testText =
    "This is the first sentence. This is the second sentence! This is the third sentence? " +
    "This is the fourth sentence. This is the fifth sentence.";

  test("should chunk text with FIXED strategy", async () => {
    const result = await textChunker({
      text: testText,
      chunkSize: 50,
      chunkOverlap: 10,
      strategy: ChunkingStrategy.FIXED,
    });

    expect(result.chunks).toBeDefined();
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.metadata).toHaveLength(result.chunks.length);

    // Verify metadata structure
    result.metadata.forEach((meta, idx) => {
      expect(meta).toHaveProperty("index");
      expect(meta).toHaveProperty("startChar");
      expect(meta).toHaveProperty("endChar");
      expect(meta).toHaveProperty("length");
      expect(meta.index).toBe(idx);
    });
  });

  test("should chunk with SENTENCE strategy", async () => {
    const result = await textChunker({
      text: testText,
      chunkSize: 80,
      chunkOverlap: 20,
      strategy: ChunkingStrategy.SENTENCE,
    });

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.metadata).toHaveLength(result.chunks.length);

    // Chunks should respect sentence boundaries
    result.chunks.forEach((chunk) => {
      expect(chunk.length).toBeGreaterThan(0);
    });
  });

  test("should chunk with PARAGRAPH strategy", async () => {
    const paragraphText =
      "First paragraph with multiple sentences. It has more content.\n\n" +
      "Second paragraph with different content. It also has sentences.\n\n" +
      "Third paragraph is here. With more text.";

    const result = await textChunker({
      text: paragraphText,
      chunkSize: 100,
      chunkOverlap: 20,
      strategy: ChunkingStrategy.PARAGRAPH,
    });

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.metadata).toHaveLength(result.chunks.length);
  });

  test("should handle default parameters", async () => {
    const result = await textChunker({
      text: testText,
    });

    // Default: chunkSize=512, chunkOverlap=50, strategy=FIXED
    expect(result.chunks).toBeDefined();
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.metadata).toHaveLength(result.chunks.length);
  });

  test("should handle chunkOverlap correctly", async () => {
    const shortText = "A".repeat(100); // 100 characters
    const result = await textChunker({
      text: shortText,
      chunkSize: 30,
      chunkOverlap: 10,
      strategy: ChunkingStrategy.FIXED,
    });

    // With chunkSize=30 and overlap=10, we move forward by 20 each time
    // Should have multiple chunks
    expect(result.chunks.length).toBeGreaterThan(1);

    // Verify overlap by checking that chunks share content
    if (result.chunks.length > 1) {
      const firstChunkEnd = result.chunks[0].slice(-10);
      const secondChunkStart = result.chunks[1].slice(0, 10);
      // There should be some overlap
      expect(firstChunkEnd).toBe(secondChunkStart);
    }
  });

  test("should handle zero overlap", async () => {
    const result = await textChunker({
      text: testText,
      chunkSize: 50,
      chunkOverlap: 0,
      strategy: ChunkingStrategy.FIXED,
    });

    expect(result.chunks.length).toBeGreaterThan(0);
    // With zero overlap, chunks should be adjacent
    result.metadata.forEach((meta, idx) => {
      if (idx > 0) {
        const prevMeta = result.metadata[idx - 1];
        expect(meta.startChar).toBe(prevMeta.endChar);
      }
    });
  });

  test("should handle text shorter than chunkSize", async () => {
    const shortText = "Short text";
    const result = await textChunker({
      text: shortText,
      chunkSize: 100,
      chunkOverlap: 10,
    });

    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0]).toBe(shortText);
    expect(result.metadata[0].length).toBe(shortText.length);
  });

  test("should handle empty text", async () => {
    const result = await textChunker({
      text: "",
      chunkSize: 50,
    });

    // Empty text should produce empty chunks or handle gracefully
    expect(result.chunks).toBeDefined();
    expect(result.metadata).toBeDefined();
  });

  test("should include all text in chunks (no loss)", async () => {
    const result = await textChunker({
      text: testText,
      chunkSize: 50,
      chunkOverlap: 10,
      strategy: ChunkingStrategy.FIXED,
    });

    // Reconstruct text from chunks (accounting for overlap)
    const totalChars = result.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    // With overlap, total should be >= original length
    expect(totalChars).toBeGreaterThanOrEqual(testText.length);
  });

  test("should handle SEMANTIC strategy (currently same as sentence)", async () => {
    const result = await textChunker({
      text: testText,
      chunkSize: 80,
      chunkOverlap: 20,
      strategy: ChunkingStrategy.SEMANTIC,
    });

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.metadata).toHaveLength(result.chunks.length);
  });

  test("should preserve chunk order", async () => {
    const result = await textChunker({
      text: testText,
      chunkSize: 50,
      chunkOverlap: 10,
    });

    // Metadata indices should be sequential
    result.metadata.forEach((meta, idx) => {
      expect(meta.index).toBe(idx);
    });

    // Start positions should be in order
    for (let i = 1; i < result.metadata.length; i++) {
      expect(result.metadata[i].startChar).toBeGreaterThanOrEqual(
        result.metadata[i - 1].startChar!
      );
    }
  });

  test("should handle very large chunkSize", async () => {
    const result = await textChunker({
      text: testText,
      chunkSize: 10000,
      chunkOverlap: 0,
    });

    // Should produce single chunk
    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0]).toBe(testText);
  });

  test("should handle overlap equal to chunkSize (edge case)", async () => {
    // This should be handled to prevent infinite loops
    const result = await textChunker({
      text: testText,
      chunkSize: 50,
      chunkOverlap: 50,
    });

    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.metadata.length).toBe(result.chunks.length);
  });

  test("should handle overlap greater than chunkSize (edge case)", async () => {
    // Should handle gracefully
    const result = await textChunker({
      text: testText,
      chunkSize: 30,
      chunkOverlap: 50,
    });

    expect(result.chunks.length).toBeGreaterThan(0);
  });
});
