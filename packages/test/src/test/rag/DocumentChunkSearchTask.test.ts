/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChunkVectorSearchTask } from "@workglow/ai";
import {
  DocumentChunk,
  DocumentChunkDataset,
  DocumentChunkPrimaryKey,
  DocumentChunkSchema,
  registerDocumentChunkDataset,
} from "@workglow/dataset";
import { InMemoryVectorStorage } from "@workglow/storage";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("ChunkVectorSearchTask", () => {
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
      new Float32Array([1.0, 0.0, 0.0]), // doc1 - similar to query
      new Float32Array([0.8, 0.2, 0.0]), // doc2 - somewhat similar
      new Float32Array([0.0, 1.0, 0.0]), // doc3 - different
      new Float32Array([0.0, 0.0, 1.0]), // doc4 - different
      new Float32Array([0.9, 0.1, 0.0]), // doc5 - very similar
    ];

    const metadata = [
      { text: "Document about AI", category: "tech" },
      { text: "Document about machine learning", category: "tech" },
      { text: "Document about cooking", category: "food" },
      { text: "Document about travel", category: "travel" },
      { text: "Document about artificial intelligence", category: "tech" },
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

  test("should search and return top K results", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const task = new ChunkVectorSearchTask();
    const result = await task.run({
      dataset: dataset,
      query: queryVector,
      topK: 3,
    });

    expect(result.count).toBe(3);
    expect(result.ids).toHaveLength(3);
    expect(result.vectors).toHaveLength(3);
    expect(result.metadata).toHaveLength(3);
    expect(result.scores).toHaveLength(3);

    // Scores should be in descending order
    for (let i = 1; i < result.scores.length; i++) {
      expect(result.scores[i - 1]).toBeGreaterThanOrEqual(result.scores[i]);
    }

    // Most similar should be doc1_0 (exact match)
    expect(result.ids[0]).toBe("doc1_0");
  });

  test("should respect topK limit", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const task = new ChunkVectorSearchTask();
    const result = await task.run({
      dataset,
      query: queryVector,
      topK: 2,
    });

    expect(result.count).toBe(2);
    expect(result.ids).toHaveLength(2);
  });

  test("should filter by metadata", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const task = new ChunkVectorSearchTask();
    const result = await task.run({
      dataset,
      query: queryVector,
      topK: 10,
      filter: { category: "tech" },
    });

    expect(result.count).toBeGreaterThan(0);
    // All results should have category "tech"
    result.metadata.forEach((meta) => {
      expect(meta).toHaveProperty("category", "tech");
    });
  });

  test("should apply score threshold", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const task = new ChunkVectorSearchTask();
    const result = await task.run({
      dataset,
      query: queryVector,
      topK: 10,
      scoreThreshold: 0.9,
    });

    // All scores should be >= 0.9
    result.scores.forEach((score) => {
      expect(score).toBeGreaterThanOrEqual(0.9);
    });
  });

  test("should return empty results when no matches", async () => {
    const queryVector = new Float32Array([0.0, 0.0, 1.0]);

    const task = new ChunkVectorSearchTask();
    const result = await task.run({
      dataset,
      query: queryVector,
      topK: 10,
      filter: { category: "nonexistent" },
    });

    expect(result.count).toBe(0);
    expect(result.ids).toHaveLength(0);
    expect(result.vectors).toHaveLength(0);
    expect(result.metadata).toHaveLength(0);
    expect(result.scores).toHaveLength(0);
  });

  test("should handle default topK value", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const task = new ChunkVectorSearchTask();
    const result = await task.run({
      dataset,
      query: queryVector,
    });

    // Default topK is 10, but we only have 5 documents
    expect(result.count).toBe(5);
    expect(result.count).toBeLessThanOrEqual(10);
  });

  test("should work with quantized query vectors (Int8Array)", async () => {
    const queryVector = new Int8Array([127, 0, 0]);

    const task = new ChunkVectorSearchTask();
    const result = await task.run({
      dataset,
      query: queryVector,
      topK: 3,
    });

    expect(result.count).toBeGreaterThan(0);
    expect(result.ids).toHaveLength(result.count);
    expect(result.scores).toHaveLength(result.count);
  });

  test("should return results sorted by similarity score", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const task = new ChunkVectorSearchTask();
    const result = await task.run({
      dataset,
      query: queryVector,
      topK: 5,
    });

    // Verify descending order
    for (let i = 1; i < result.scores.length; i++) {
      expect(result.scores[i - 1]).toBeGreaterThanOrEqual(result.scores[i]);
    }
  });

  test("should handle empty repository", async () => {
    const emptyStorage = new InMemoryVectorStorage<
      typeof DocumentChunkSchema,
      typeof DocumentChunkPrimaryKey,
      Record<string, unknown>,
      Float32Array,
      DocumentChunk
    >(DocumentChunkSchema, DocumentChunkPrimaryKey, [], 3, Float32Array);
    await emptyStorage.setupDatabase();
    const emptyDataset = new DocumentChunkDataset(emptyStorage);

    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const task = new ChunkVectorSearchTask();
    const result = await task.run({
      dataset: emptyDataset,
      query: queryVector,
      topK: 10,
    });

    expect(result.count).toBe(0);
    expect(result.ids).toHaveLength(0);
    expect(result.scores).toHaveLength(0);

    emptyStorage.destroy();
  });

  test("should combine filter and score threshold", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const task = new ChunkVectorSearchTask();
    const result = await task.run({
      dataset,
      query: queryVector,
      topK: 10,
      filter: { category: "tech" },
      scoreThreshold: 0.7,
    });

    // All results should pass both filter and threshold
    result.metadata.forEach((meta) => {
      expect(meta).toHaveProperty("category", "tech");
    });
    result.scores.forEach((score) => {
      expect(score).toBeGreaterThanOrEqual(0.7);
    });
  });

  test("should resolve repository from string ID", async () => {
    // Register dataset by ID
    registerDocumentChunkDataset("test-vector-repo", dataset);

    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const task = new ChunkVectorSearchTask();
    // Pass repository as string ID instead of instance
    const result = await task.run({
      dataset: "test-vector-repo",
      query: queryVector,
      topK: 3,
    });

    expect(result.count).toBe(3);
    expect(result.ids).toHaveLength(3);
    expect(result.vectors).toHaveLength(3);
    expect(result.metadata).toHaveLength(3);
    expect(result.scores).toHaveLength(3);

    // Most similar should be doc1_0 (exact match)
    expect(result.ids[0]).toBe("doc1_0");
  });
});
