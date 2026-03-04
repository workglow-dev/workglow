/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChunkVectorSearchTask } from "@workglow/ai";
import {
  createKnowledgeBase,
  KnowledgeBase,
  registerKnowledgeBase,
} from "@workglow/knowledge-base";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { setLogger, uuid4 } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("ChunkVectorSearchTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let kb: KnowledgeBase;

  beforeEach(async () => {
    kb = await createKnowledgeBase({
      name: `search-test-${uuid4()}`,
      vectorDimensions: 3,
      register: false,
    });

    // Populate with test data
    const vectors = [
      new Float32Array([1.0, 0.0, 0.0]), // doc1 - similar to query
      new Float32Array([0.8, 0.2, 0.0]), // doc2 - somewhat similar
      new Float32Array([0.0, 1.0, 0.0]), // doc3 - different
      new Float32Array([0.0, 0.0, 1.0]), // doc4 - different
      new Float32Array([0.9, 0.1, 0.0]), // doc5 - very similar
    ];

    const metadata = [
      { chunkId: "doc1_0", doc_id: "doc1", text: "Document about AI", nodePath: [], depth: 0, category: "tech" },
      { chunkId: "doc2_0", doc_id: "doc2", text: "Document about machine learning", nodePath: [], depth: 0, category: "tech" },
      { chunkId: "doc3_0", doc_id: "doc3", text: "Document about cooking", nodePath: [], depth: 0, category: "food" },
      { chunkId: "doc4_0", doc_id: "doc4", text: "Document about travel", nodePath: [], depth: 0, category: "travel" },
      { chunkId: "doc5_0", doc_id: "doc5", text: "Document about artificial intelligence", nodePath: [], depth: 0, category: "tech" },
    ];

    for (let i = 0; i < vectors.length; i++) {
      const doc_id = `doc${i + 1}`;
      await kb.upsertChunk({
        chunk_id: `${doc_id}_0`,
        doc_id,
        vector: vectors[i],
        metadata: metadata[i],
      });
    }
  });

  afterEach(() => {
    kb.destroy();
  });

  test("should search and return top K results", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const task = new ChunkVectorSearchTask();
    const result = await task.run({
      knowledgeBase: kb,
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
      knowledgeBase: kb,
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
      knowledgeBase: kb,
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
      knowledgeBase: kb,
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
      knowledgeBase: kb,
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
      knowledgeBase: kb,
      query: queryVector,
    });

    // Default topK is 10, but we only have 5 documents
    expect(result.count).toBe(5);
    expect(result.count).toBeLessThanOrEqual(10);
  });

  test("should return results sorted by similarity score", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const task = new ChunkVectorSearchTask();
    const result = await task.run({
      knowledgeBase: kb,
      query: queryVector,
      topK: 5,
    });

    // Verify descending order
    for (let i = 1; i < result.scores.length; i++) {
      expect(result.scores[i - 1]).toBeGreaterThanOrEqual(result.scores[i]);
    }
  });

  test("should handle empty knowledge base", async () => {
    const emptyKb = await createKnowledgeBase({
      name: `empty-search-${uuid4()}`,
      vectorDimensions: 3,
      register: false,
    });

    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const task = new ChunkVectorSearchTask();
    const result = await task.run({
      knowledgeBase: emptyKb,
      query: queryVector,
      topK: 10,
    });

    expect(result.count).toBe(0);
    expect(result.ids).toHaveLength(0);
    expect(result.scores).toHaveLength(0);

    emptyKb.destroy();
  });

  test("should resolve knowledge base from string ID", async () => {
    registerKnowledgeBase("test-vector-kb", kb);

    const queryVector = new Float32Array([1.0, 0.0, 0.0]);

    const task = new ChunkVectorSearchTask();
    const result = await task.run({
      knowledgeBase: "test-vector-kb",
      query: queryVector,
      topK: 3,
    });

    expect(result.count).toBe(3);
    expect(result.ids).toHaveLength(3);
    expect(result.ids[0]).toBe("doc1_0");
  });
});
