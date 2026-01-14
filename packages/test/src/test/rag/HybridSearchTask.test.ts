/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { hybridSearch } from "@workglow/ai";
import { InMemoryChunkVectorStorage, registerChunkVectorRepository } from "@workglow/storage";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("ChunkVectorHybridSearchTask", () => {
  let repo: InMemoryChunkVectorStorage;

  beforeEach(async () => {
    repo = new InMemoryChunkVectorStorage(3);
    await repo.setupDatabase();

    // Populate repository with test data
    const vectors = [
      new Float32Array([1.0, 0.0, 0.0]), // Similar vector, contains "machine"
      new Float32Array([0.8, 0.2, 0.0]), // Somewhat similar, contains "learning"
      new Float32Array([0.0, 1.0, 0.0]), // Different vector, contains "cooking"
      new Float32Array([0.0, 0.0, 1.0]), // Different vector, contains "travel"
      new Float32Array([0.9, 0.1, 0.0]), // Very similar, contains "artificial"
    ];

    const metadata = [
      { text: "Document about machine learning", category: "tech" },
      { text: "Document about deep learning algorithms", category: "tech" },
      { text: "Document about cooking recipes", category: "food" },
      { text: "Document about travel destinations", category: "travel" },
      { text: "Document about artificial intelligence", category: "tech" },
    ];

    for (let i = 0; i < vectors.length; i++) {
      const doc_id = `doc${i + 1}`;
      await repo.put({
        id: `${doc_id}_0`,
        doc_id,
        vector: vectors[i] as any,
        metadata: metadata[i],
      } as any);
    }
  });

  afterEach(() => {
    repo.destroy();
  });

  test("should perform hybrid search with vector and text query", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "machine learning";

    const result = await hybridSearch({
      repository: repo,
      queryVector: queryVector,
      queryText: queryText,
      topK: 3,
    });

    expect(result.count).toBeGreaterThan(0);
    expect(result.chunks).toHaveLength(result.count);
    expect(result.ids).toHaveLength(result.count);
    expect(result.metadata).toHaveLength(result.count);
    expect(result.scores).toHaveLength(result.count);

    // Scores should be in descending order
    for (let i = 1; i < result.scores.length; i++) {
      expect(result.scores[i - 1]).toBeGreaterThanOrEqual(result.scores[i]);
    }
  });

  test("should combine vector and text scores", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "machine";

    const result = await hybridSearch({
      repository: repo,
      queryVector: queryVector,
      queryText: queryText,
      topK: 5,
    });

    // Results should be ranked by combined score
    expect(result.scores.length).toBeGreaterThan(0);
    result.scores.forEach((score) => {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  test("should respect vectorWeight parameter", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "learning";

    // Test with high vector weight
    const resultHighVector = await hybridSearch({
      repository: repo,
      queryVector: queryVector,
      queryText: queryText,
      topK: 5,
      vectorWeight: 0.9,
    });

    // Test with low vector weight (high text weight)
    const resultHighText = await hybridSearch({
      repository: repo,
      queryVector: queryVector,
      queryText: queryText,
      topK: 5,
      vectorWeight: 0.1,
    });

    // Results might differ based on weight
    expect(resultHighVector.count).toBeGreaterThan(0);
    expect(resultHighText.count).toBeGreaterThan(0);
  });

  test("should return vectors when returnVectors is true", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "machine";

    const result = await hybridSearch({
      repository: repo,
      queryVector: queryVector,
      queryText: queryText,
      topK: 3,
      returnVectors: true,
    });

    expect(result.vectors).toBeDefined();
    expect(result.vectors).toHaveLength(result.count);
    expect(result.vectors![0]).toBeInstanceOf(Float32Array);
  });

  test("should not return vectors when returnVectors is false", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "machine";

    const result = await hybridSearch({
      repository: repo,
      queryVector: queryVector,
      queryText: queryText,
      topK: 3,
      returnVectors: false,
    });

    expect(result.vectors).toBeUndefined();
  });

  test("should apply metadata filter", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "learning";

    const result = await hybridSearch({
      repository: repo,
      queryVector: queryVector,
      queryText: queryText,
      topK: 10,
      filter: { category: "tech" },
    });

    // All results should have category "tech"
    result.metadata.forEach((meta) => {
      expect(meta).toHaveProperty("category", "tech");
    });
  });

  test("should apply score threshold", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "machine";

    const result = await hybridSearch({
      repository: repo,
      queryVector: queryVector,
      queryText: queryText,
      topK: 10,
      scoreThreshold: 0.5,
    });

    // All scores should be >= threshold
    result.scores.forEach((score) => {
      expect(score).toBeGreaterThanOrEqual(0.5);
    });
  });

  test("should respect topK limit", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "document";

    const result = await hybridSearch({
      repository: repo,
      queryVector: queryVector,
      queryText: queryText,
      topK: 2,
    });

    expect(result.count).toBeLessThanOrEqual(2);
    expect(result.chunks).toHaveLength(result.count);
  });

  test("should handle default parameters", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "learning";

    const result = await hybridSearch({
      repository: repo,
      queryVector: queryVector,
      queryText: queryText,
    });

    // Default topK is 10, vectorWeight is 0.7
    expect(result.count).toBeGreaterThan(0);
    expect(result.count).toBeLessThanOrEqual(10);
  });

  test("should extract chunks from metadata", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "machine";

    const result = await hybridSearch({
      repository: repo,
      queryVector: queryVector,
      queryText: queryText,
      topK: 5,
    });

    // Chunks should match metadata text
    result.chunks.forEach((chunk, idx) => {
      expect(chunk).toBe(result.metadata[idx].text);
    });
  });

  test("should work with quantized query vectors", async () => {
    const queryVector = new Int8Array([127, 0, 0]);
    const queryText = "machine";

    const result = await hybridSearch({
      repository: repo,
      queryVector: queryVector,
      queryText: queryText,
      topK: 3,
    });

    expect(result.count).toBeGreaterThan(0);
    expect(result.chunks).toHaveLength(result.count);
  });

  test("should resolve repository from string ID", async () => {
    // Register repository by ID
    registerChunkVectorRepository("test-hybrid-repo", repo);

    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "machine learning";

    // Pass repository as string ID instead of instance
    const result = await hybridSearch({
      repository: "test-hybrid-repo" as any,
      queryVector: queryVector,
      queryText: queryText,
      topK: 3,
    });

    expect(result.count).toBeGreaterThan(0);
    expect(result.chunks).toHaveLength(result.count);
    expect(result.ids).toHaveLength(result.count);
    expect(result.metadata).toHaveLength(result.count);
    expect(result.scores).toHaveLength(result.count);

    // Scores should be in descending order
    for (let i = 1; i < result.scores.length; i++) {
      expect(result.scores[i - 1]).toBeGreaterThanOrEqual(result.scores[i]);
    }
  });
});
