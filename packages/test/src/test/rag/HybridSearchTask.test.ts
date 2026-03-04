/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { hybridSearch } from "@workglow/ai";
import {
  createKnowledgeBase,
  KnowledgeBase,
  registerKnowledgeBase,
} from "@workglow/dataset";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { setLogger, uuid4 } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("ChunkVectorHybridSearchTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let kb: KnowledgeBase;

  beforeEach(async () => {
    kb = await createKnowledgeBase({
      name: `hybrid-test-${uuid4()}`,
      vectorDimensions: 3,
      register: false,
    });

    // Populate with test data
    const vectors = [
      new Float32Array([1.0, 0.0, 0.0]),
      new Float32Array([0.8, 0.2, 0.0]),
      new Float32Array([0.0, 1.0, 0.0]),
      new Float32Array([0.0, 0.0, 1.0]),
      new Float32Array([0.9, 0.1, 0.0]),
    ];

    const metadata = [
      { chunkId: "doc1_0", doc_id: "doc1", text: "Document about machine learning", nodePath: [], depth: 0, category: "tech" },
      { chunkId: "doc2_0", doc_id: "doc2", text: "Document about deep learning algorithms", nodePath: [], depth: 0, category: "tech" },
      { chunkId: "doc3_0", doc_id: "doc3", text: "Document about cooking recipes", nodePath: [], depth: 0, category: "food" },
      { chunkId: "doc4_0", doc_id: "doc4", text: "Document about travel destinations", nodePath: [], depth: 0, category: "travel" },
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

  test("should perform hybrid search with vector and text query", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "machine learning";

    const result = await hybridSearch({
      knowledgeBase: kb,
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
      knowledgeBase: kb,
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

    const resultHighVector = await hybridSearch({
      knowledgeBase: kb,
      queryVector: queryVector,
      queryText: queryText,
      topK: 5,
      vectorWeight: 0.9,
    });

    const resultHighText = await hybridSearch({
      knowledgeBase: kb,
      queryVector: queryVector,
      queryText: queryText,
      topK: 5,
      vectorWeight: 0.1,
    });

    expect(resultHighVector.count).toBeGreaterThan(0);
    expect(resultHighText.count).toBeGreaterThan(0);
  });

  test("should return vectors when returnVectors is true", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "machine";

    const result = await hybridSearch({
      knowledgeBase: kb,
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
      knowledgeBase: kb,
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
      knowledgeBase: kb,
      queryVector: queryVector,
      queryText: queryText,
      topK: 10,
      filter: { category: "tech" },
    });

    result.metadata.forEach((meta) => {
      expect(meta).toHaveProperty("category", "tech");
    });
  });

  test("should apply score threshold", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "machine";

    const result = await hybridSearch({
      knowledgeBase: kb,
      queryVector: queryVector,
      queryText: queryText,
      topK: 10,
      scoreThreshold: 0.5,
    });

    result.scores.forEach((score) => {
      expect(score).toBeGreaterThanOrEqual(0.5);
    });
  });

  test("should respect topK limit", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "document";

    const result = await hybridSearch({
      knowledgeBase: kb,
      queryVector: queryVector,
      queryText: queryText,
      topK: 2,
    });

    expect(result.count).toBeLessThanOrEqual(2);
    expect(result.chunks).toHaveLength(result.count);
  });

  test("should extract chunks from metadata", async () => {
    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "machine";

    const result = await hybridSearch({
      knowledgeBase: kb,
      queryVector: queryVector,
      queryText: queryText,
      topK: 5,
    });

    // Chunks should match metadata text
    result.chunks.forEach((chunk, idx) => {
      expect(chunk).toBe(result.metadata[idx].text);
    });
  });

  test("should resolve knowledge base from string ID", async () => {
    registerKnowledgeBase("test-hybrid-kb", kb);

    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const queryText = "machine learning";

    const result = await hybridSearch({
      knowledgeBase: "test-hybrid-kb",
      queryVector: queryVector,
      queryText: queryText,
      topK: 3,
    });

    expect(result.count).toBeGreaterThan(0);
    expect(result.chunks).toHaveLength(result.count);
  });
});
