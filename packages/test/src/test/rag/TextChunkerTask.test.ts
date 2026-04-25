/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChunkingStrategy, textChunker } from "@workglow/ai";
import { describe, expect, test } from "vitest";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("TextChunkerTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  const testText =
    "This is the first sentence. This is the second sentence! This is the third sentence? " +
    "This is the fourth sentence. This is the fifth sentence.";

  test("should chunk text with FIXED strategy and emit ChunkRecord[]", async () => {
    const result = await textChunker({
      text: testText,
      doc_id: "my-doc",
      chunkSize: 50,
      chunkOverlap: 10,
      strategy: ChunkingStrategy.FIXED,
    });

    expect(result.chunks).toBeDefined();
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.count).toBe(result.chunks.length);
    expect(result.text).toHaveLength(result.chunks.length);
    expect(result.doc_id).toBe("my-doc");

    result.chunks.forEach((chunk, idx) => {
      expect(chunk.chunkId).toBe(`my-doc:${idx}`);
      expect(chunk.doc_id).toBe("my-doc");
      expect(chunk.text).toBe(result.text[idx]);
      expect(chunk.nodePath).toEqual(["my-doc"]);
      expect(chunk.depth).toBe(chunk.nodePath.length);
    });
  });

  test("should omit doc_id from output when not provided and emit deterministic chunkIds", async () => {
    const first = await textChunker({ text: testText, chunkSize: 50 });
    const second = await textChunker({ text: testText, chunkSize: 50 });

    expect(first.doc_id).toBeUndefined();
    expect(second.doc_id).toBeUndefined();
    expect(first.chunks.map((c) => c.chunkId)).toEqual(second.chunks.map((c) => c.chunkId));
    first.chunks.forEach((chunk) => {
      expect(chunk.doc_id).toBe("");
      expect(chunk.nodePath).toEqual([]);
      expect(chunk.depth).toBe(0);
      expect(chunk.chunkId).toMatch(/^chunk:\d+:\d+$/);
    });
  });

  test("should chunk with SENTENCE strategy", async () => {
    const result = await textChunker({
      text: testText,
      doc_id: "d1",
      chunkSize: 80,
      chunkOverlap: 20,
      strategy: ChunkingStrategy.SENTENCE,
    });

    expect(result.chunks.length).toBeGreaterThan(0);
    result.chunks.forEach((chunk) => {
      expect(chunk.text.length).toBeGreaterThan(0);
    });
  });

  test("should chunk with PARAGRAPH strategy", async () => {
    const paragraphText =
      "First paragraph with multiple sentences. It has more content.\n\n" +
      "Second paragraph with different content. It also has sentences.\n\n" +
      "Third paragraph is here. With more text.";

    const result = await textChunker({
      text: paragraphText,
      doc_id: "d1",
      chunkSize: 100,
      chunkOverlap: 20,
      strategy: ChunkingStrategy.PARAGRAPH,
    });

    expect(result.chunks.length).toBeGreaterThan(0);
  });

  test("should honour a provided doc_id", async () => {
    const result = await textChunker({
      text: testText,
      doc_id: "my-doc",
      chunkSize: 50,
    });

    expect(result.doc_id).toBe("my-doc");
    result.chunks.forEach((chunk) => {
      expect(chunk.doc_id).toBe("my-doc");
    });
  });

  test("should handle default parameters", async () => {
    const result = await textChunker({ text: testText });
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  test("should handle chunkOverlap correctly", async () => {
    const shortText = "A".repeat(100);
    const result = await textChunker({
      text: shortText,
      chunkSize: 30,
      chunkOverlap: 10,
      strategy: ChunkingStrategy.FIXED,
    });

    expect(result.chunks.length).toBeGreaterThan(1);

    if (result.chunks.length > 1) {
      const firstChunkEnd = result.chunks[0].text.slice(-10);
      const secondChunkStart = result.chunks[1].text.slice(0, 10);
      expect(firstChunkEnd).toBe(secondChunkStart);
    }
  });

  test("should handle text shorter than chunkSize", async () => {
    const shortText = "Short text";
    const result = await textChunker({ text: shortText, chunkSize: 100, chunkOverlap: 10 });

    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0].text).toBe(shortText);
  });

  test("should handle empty text", async () => {
    const result = await textChunker({ text: "", chunkSize: 50 });
    expect(result.chunks).toBeDefined();
  });

  test("should handle SEMANTIC strategy (aliased to sentence)", async () => {
    const result = await textChunker({
      text: testText,
      chunkSize: 80,
      chunkOverlap: 20,
      strategy: ChunkingStrategy.SEMANTIC,
    });

    expect(result.chunks.length).toBeGreaterThan(0);
  });

  test("should handle very large chunkSize", async () => {
    const result = await textChunker({ text: testText, chunkSize: 10000, chunkOverlap: 0 });

    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0].text).toBe(testText);
  });

  test("should handle overlap equal to chunkSize (edge case)", async () => {
    const result = await textChunker({ text: testText, chunkSize: 50, chunkOverlap: 50 });
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  test("should handle overlap greater than chunkSize (edge case)", async () => {
    const result = await textChunker({ text: testText, chunkSize: 30, chunkOverlap: 50 });
    expect(result.chunks.length).toBeGreaterThan(0);
  });
});
