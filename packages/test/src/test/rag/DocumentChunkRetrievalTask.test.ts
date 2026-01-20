/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { chunkRetrieval } from "@workglow/ai";
import {
  DocumentChunk, DocumentChunkDataset,
  DocumentChunkPrimaryKey,
  DocumentChunkSchema,
  registerDocumentChunkDataset
} from "@workglow/dataset";
import { InMemoryVectorStorage } from "@workglow/storage";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("ChunkRetrievalTask", () => {
  let storage: InMemoryVectorStorage<
    typeof DocumentChunkSchema,
    typeof DocumentChunkPrimaryKey,
    Record<string, unknown>,
    Float32Array,
    DocumentChunk
  >;
  let dataset: DocumentChunkDataset;

  beforeEach(async () => {
    storage = new InMemoryVectorStorage<
      typeof DocumentChunkSchema,
      typeof DocumentChunkPrimaryKey,
      Record<string, unknown>,
      Float32Array,
      DocumentChunk
    >(DocumentChunkSchema, DocumentChunkPrimaryKey, [], 3, Float32Array);
    await storage.setupDatabase();
    dataset = new DocumentChunkDataset(storage);

    // Populate repository with test data
    const vectors = [
      new Float32Array([1.0, 0.0, 0.0]),
      new Float32Array([0.8, 0.2, 0.0]),
      new Float32Array([0.0, 1.0, 0.0]),
      new Float32Array([0.0, 0.0, 1.0]),
      new Float32Array([0.9, 0.1, 0.0]),
    ];

    const metadata = [
      { text: "First chunk about AI" },
      { text: "Second chunk about machine learning" },
      { content: "Third chunk about cooking" },
      { chunk: "Fourth chunk about travel" },
      { text: "Fifth chunk about artificial intelligence" },
    ];

    for (let i = 0; i < vectors.length; i++) {
      const doc_id = `doc${i + 1}`;
      await dataset.put({
        chunk_id: `${doc_id}_0`,
        doc_id,
        vector: vectors[i],
        metadata: metadata[i],
      });
    }
  });

  afterEach(() => {
    storage.destroy();
  });

  test("should retrieve chunks with query vector", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      dataset,
      query: queryVector,
      topK: 3,
    });

    expect(result.count).toBe(3);
    expect(result.chunks).toHaveLength(3);
    expect(result.ids).toHaveLength(3);
    expect(result.metadata).toHaveLength(3);
    expect(result.scores).toHaveLength(3);

    // Chunks should be extracted from metadata
    expect(result.chunks[0]).toBeTruthy();
    expect(typeof result.chunks[0]).toBe("string");
  });

  test("should extract text from metadata.text field", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      dataset,
      query: queryVector,
      topK: 5,
    });

    // Find chunks that have text field
    const textChunks = result.chunks.filter((chunk, idx) => {
      const meta = result.metadata[idx];
      return meta.text !== undefined;
    });

    expect(textChunks.length).toBeGreaterThan(0);
    textChunks.forEach((chunk, idx) => {
      const originalIdx = result.chunks.indexOf(chunk);
      expect(chunk).toBe(result.metadata[originalIdx].text);
    });
  });

  test("should extract text from metadata.content field as fallback", async () => {
    const queryVector = new Float32Array([0.0, 1.0, 0.0]);

    const result = await chunkRetrieval({
      dataset,
      query: queryVector,
      topK: 5,
    });

    // Find the chunk with content field
    const contentChunkIdx = result.metadata.findIndex((meta) => meta.content !== undefined);
    if (contentChunkIdx >= 0) {
      expect(result.chunks[contentChunkIdx]).toBe(result.metadata[contentChunkIdx].content);
    }
  });

  test("should extract text from metadata.chunk field as fallback", async () => {
    const queryVector = new Float32Array([0.0, 0.0, 1.0]);

    const result = await chunkRetrieval({
      dataset,
      query: queryVector,
      topK: 5,
    });

    // Find the chunk with chunk field
    const chunkIdx = result.metadata.findIndex((meta) => meta.chunk !== undefined);
    if (chunkIdx >= 0) {
      expect(result.chunks[chunkIdx]).toBe(result.metadata[chunkIdx].chunk);
    }
  });

  test("should return vectors when returnVectors is true", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      dataset,
      query: queryVector,
      topK: 3,
      returnVectors: true,
    });

    expect(result.vectors).toBeDefined();
    expect(result.vectors).toHaveLength(3);
    expect(result.vectors![0]).toBeInstanceOf(Float32Array);
  });

  test("should not return vectors when returnVectors is false", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      dataset,
      query: queryVector,
      topK: 3,
      returnVectors: false,
    });

    expect(result.vectors).toBeUndefined();
  });

  test("should respect topK parameter", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      dataset,
      query: queryVector,
      topK: 2,
    });

    expect(result.count).toBe(2);
    expect(result.chunks).toHaveLength(2);
  });

  test("should apply metadata filter", async () => {
    // Add a document with specific metadata for filtering
    await dataset.put({
      chunk_id: "filtered_doc_0",
      doc_id: "filtered_doc",
      vector: new Float32Array([1.0, 0.0, 0.0]),
      metadata: {
        text: "Filtered document",
        category: "test",
      },
    });

    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      dataset,
      query: queryVector,
      topK: 10,
      filter: { category: "test" },
    });

    expect(result.count).toBe(1);
    expect(result.ids[0]).toBe("filtered_doc_0");
  });

  test("should apply score threshold", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      dataset,
      query: queryVector,
      topK: 10,
      scoreThreshold: 0.9,
    });

    result.scores.forEach((score) => {
      expect(score).toBeGreaterThanOrEqual(0.9);
    });
  });

  test("should use queryEmbedding when provided", async () => {
    const queryEmbedding = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      dataset,
      query: queryEmbedding,
      topK: 3,
    });

    expect(result.count).toBe(3);
    expect(result.chunks).toHaveLength(3);
  });

  test("should throw error when query is string without model", async () => {
    await expect(
      // @ts-expect-error - query is string but no model is provided
      chunkRetrieval({
        dataset,
        query: "test query string",
        topK: 3,
      })
    ).rejects.toThrow("model");
  });

  test("should handle default topK value", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      dataset,
      query: queryVector,
    });

    // Default topK is 5
    expect(result.count).toBe(5);
    expect(result.count).toBeLessThanOrEqual(5);
  });

  test("should JSON.stringify metadata when no text/content/chunk fields", async () => {
    // Add document with only non-standard metadata
    await dataset.put({
      chunk_id: "json_doc_0",
      doc_id: "json_doc",
      vector: new Float32Array([1.0, 0.0, 0.0]),
      metadata: {
        title: "Title only",
        author: "Author name",
      },
    });

    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const result = await chunkRetrieval({
      dataset,
      query: queryVector,
      topK: 10,
    });

    // Find the JSON stringified chunk
    const jsonChunk = result.chunks.find((chunk) => chunk.includes("title"));
    expect(jsonChunk).toBeDefined();
    expect(jsonChunk).toContain("Title only");
    expect(jsonChunk).toContain("Author name");
  });

  test("should resolve repository from string ID", async () => {
    // Register repository by ID
    registerDocumentChunkDataset("test-retrieval-repo", dataset);

    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    // Pass repository as string ID instead of instance
    const result = await chunkRetrieval({
      dataset: "test-retrieval-repo",
      query: queryVector,
      topK: 3,
    });

    expect(result.count).toBe(3);
    expect(result.chunks).toHaveLength(3);
    expect(result.ids).toHaveLength(3);
    expect(result.metadata).toHaveLength(3);
    expect(result.scores).toHaveLength(3);

    // Chunks should be extracted from metadata
    expect(result.chunks[0]).toBeTruthy();
    expect(typeof result.chunks[0]).toBe("string");
  });
});
