/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChunkVectorUpsertTask } from "@workglow/ai";
import {
  createKnowledgeBase,
  KnowledgeBase,
  registerKnowledgeBase,
} from "@workglow/dataset";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { setLogger, uuid4 } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("ChunkVectorUpsertTask", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let kb: KnowledgeBase;

  beforeEach(async () => {
    kb = await createKnowledgeBase({
      name: `upsert-test-${uuid4()}`,
      vectorDimensions: 3,
      register: false,
    });
  });

  afterEach(() => {
    kb.destroy();
  });

  test("should upsert a single vector", async () => {
    const vector = new Float32Array([0.1, 0.2, 0.3]);
    const metadata = { chunkId: "c1", doc_id: "doc1", text: "Test document", nodePath: [], depth: 0, source: "test.txt" };

    const task = new ChunkVectorUpsertTask();
    const result = await task.run({
      knowledgeBase: kb,
      doc_id: "doc1",
      vectors: vector,
      metadata: metadata,
    });

    expect(result.count).toBe(1);
    expect(result.doc_id).toBe("doc1");
    expect(result.chunk_ids).toHaveLength(1);

    // Verify vector was stored
    const retrieved = await kb.getChunk(result.chunk_ids[0]);
    expect(retrieved).toBeDefined();
    expect(retrieved?.doc_id).toBe("doc1");
    expect(retrieved!.metadata).toMatchObject({ text: "Test document" });
  });

  test("should upsert multiple vectors in bulk", async () => {
    const vectors = [
      new Float32Array([0.1, 0.2, 0.3]),
      new Float32Array([0.4, 0.5, 0.6]),
      new Float32Array([0.7, 0.8, 0.9]),
    ];
    const metadata = { chunkId: "c1", doc_id: "doc1", text: "Document with multiple vectors", nodePath: [], depth: 0, source: "doc.txt" };

    const task = new ChunkVectorUpsertTask();
    const result = await task.run({
      knowledgeBase: kb,
      doc_id: "doc1",
      vectors: vectors,
      metadata: metadata,
    });

    expect(result.count).toBe(3);
    expect(result.doc_id).toBe("doc1");
    expect(result.chunk_ids).toHaveLength(3);

    // Verify all vectors were stored
    for (let i = 0; i < 3; i++) {
      const retrieved = await kb.getChunk(result.chunk_ids[i]);
      expect(retrieved).toBeDefined();
      expect(retrieved?.doc_id).toBe("doc1");
    }
  });

  test("should handle array of single item (normalized to bulk)", async () => {
    const vector = [new Float32Array([0.1, 0.2, 0.3])];
    const metadata = { chunkId: "c1", doc_id: "doc1", text: "Single item as array", nodePath: [], depth: 0 };

    const task = new ChunkVectorUpsertTask();
    const result = await task.run({
      knowledgeBase: kb,
      doc_id: "doc1",
      vectors: vector,
      metadata: metadata,
    });

    expect(result.count).toBe(1);
    expect(result.doc_id).toBe("doc1");

    const retrieved = await kb.getChunk(result.chunk_ids[0]);
    expect(retrieved).toBeDefined();
  });

  test("should accept multiple vectors with single metadata", async () => {
    const vectors = [new Float32Array([0.1, 0.2, 0.3]), new Float32Array([0.3, 0.4, 0.5])];
    const metadata = { chunkId: "c1", doc_id: "doc1", text: "Shared metadata", nodePath: [], depth: 0 };

    const task = new ChunkVectorUpsertTask();
    const result = await task.run({
      knowledgeBase: kb,
      doc_id: "doc1",
      vectors: vectors,
      metadata: metadata,
    });

    expect(result.count).toBe(2);
    expect(result.doc_id).toBe("doc1");
  });

  test("should handle large batch upsert", async () => {
    const count = 100;
    const vectors = Array.from(
      { length: count },
      (_, i) => new Float32Array([i * 0.01, i * 0.02, i * 0.03])
    );
    const metadata = { chunkId: "c1", doc_id: "batch-doc", text: "Batch document", nodePath: [], depth: 0 };

    const task = new ChunkVectorUpsertTask();
    const result = await task.run({
      knowledgeBase: kb,
      doc_id: "batch-doc",
      vectors: vectors,
      metadata: metadata,
    });

    expect(result.count).toBe(count);
    expect(result.chunk_ids).toHaveLength(count);

    const size = await kb.chunkCount();
    expect(size).toBe(count);
  });

  test("should resolve knowledge base from string ID", async () => {
    // Register kb by ID
    registerKnowledgeBase("test-upsert-kb", kb);

    const vector = new Float32Array([0.1, 0.2, 0.3]);
    const metadata = { chunkId: "c1", doc_id: "doc1", text: "Test document", nodePath: [], depth: 0, source: "test.txt" };

    const task = new ChunkVectorUpsertTask();
    // Pass knowledge base as string ID instead of instance
    const result = await task.run({
      knowledgeBase: "test-upsert-kb",
      doc_id: "doc1",
      vectors: vector,
      metadata: metadata,
    });

    expect(result.count).toBe(1);
    expect(result.doc_id).toBe("doc1");

    // Verify vector was stored
    const retrieved = await kb.getChunk(result.chunk_ids[0]);
    expect(retrieved).toBeDefined();
    expect(retrieved?.doc_id).toBe("doc1");
  });
});
