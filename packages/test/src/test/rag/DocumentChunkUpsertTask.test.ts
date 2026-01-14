/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChunkVectorUpsertTask } from "@workglow/ai";
import {
  DocumentChunkDataset,
  DocumentChunkPrimaryKey,
  DocumentChunkSchema,
  registerDocumentChunkDataset,
} from "@workglow/dataset";
import { InMemoryVectorStorage } from "@workglow/storage";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("ChunkVectorUpsertTask", () => {
  let storage: InMemoryVectorStorage<typeof DocumentChunkSchema, typeof DocumentChunkPrimaryKey>;
  let dataset: DocumentChunkDataset;

  beforeEach(async () => {
    storage = new InMemoryVectorStorage(DocumentChunkSchema, DocumentChunkPrimaryKey, [], 3);
    await storage.setupDatabase();
    dataset = new DocumentChunkDataset(storage as any);
  });

  afterEach(() => {
    storage.destroy();
  });

  test("should upsert a single vector", async () => {
    const vector = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    const metadata = { text: "Test document", source: "test.txt" };

    const task = new ChunkVectorUpsertTask();
    const result = await task.run({
      dataset,
      doc_id: "doc1",
      vectors: vector,
      metadata: metadata,
    });

    expect(result.count).toBe(1);
    expect(result.doc_id).toBe("doc1");
    expect(result.chunk_ids).toHaveLength(1);

    // Verify vector was stored
    const retrieved = await dataset.get(result.chunk_ids[0]);
    expect(retrieved).toBeDefined();
    expect(retrieved?.doc_id).toBe("doc1");
    expect(retrieved!.metadata).toEqual(metadata);
  });

  test("should upsert multiple vectors in bulk", async () => {
    const vectors = [
      new Float32Array([0.1, 0.2, 0.3]),
      new Float32Array([0.4, 0.5, 0.6]),
      new Float32Array([0.7, 0.8, 0.9]),
    ];
    const metadata = { text: "Document with multiple vectors", source: "doc.txt" };

    const task = new ChunkVectorUpsertTask();
    const result = await task.run({
      dataset,
      doc_id: "doc1",
      vectors: vectors,
      metadata: metadata,
    });

    expect(result.count).toBe(3);
    expect(result.doc_id).toBe("doc1");
    expect(result.chunk_ids).toHaveLength(3);

    // Verify all vectors were stored
    for (let i = 0; i < 3; i++) {
      const retrieved = await dataset.get(result.chunk_ids[i]);
      expect(retrieved).toBeDefined();
      expect(retrieved?.doc_id).toBe("doc1");
      expect(retrieved!.metadata).toEqual(metadata);
    }
  });

  test("should handle array of single item (normalized to bulk)", async () => {
    const vector = [new Float32Array([0.1, 0.2, 0.3])];
    const metadata = { text: "Single item as array" };

    const task = new ChunkVectorUpsertTask();
    const result = await task.run({
      dataset,
      doc_id: "doc1",
      vectors: vector,
      metadata: metadata,
    });

    expect(result.count).toBe(1);
    expect(result.doc_id).toBe("doc1");

    const retrieved = await dataset.get(result.chunk_ids[0]);
    expect(retrieved).toBeDefined();
    expect(retrieved!.metadata).toEqual(metadata);
  });

  test("should update existing vector when upserting with same ID", async () => {
    const vector1 = new Float32Array([0.1, 0.2, 0.3]);
    const vector2 = new Float32Array([0.9, 0.8, 0.7]);
    const metadata1 = { text: "Original document" };
    const metadata2 = { text: "Updated document", source: "updated.txt" };

    // First upsert
    const task1 = new ChunkVectorUpsertTask();
    const result1 = await task1.run({
      dataset,
      doc_id: "doc1",
      vectors: vector1,
      metadata: metadata1,
    });

    // Update with same ID
    const task2 = new ChunkVectorUpsertTask();
    const result2 = await task2.run({
      dataset,
      doc_id: "doc1",
      vectors: vector2,
      metadata: metadata2,
    });

    const retrieved = await dataset.get(result2.chunk_ids[0]);
    expect(retrieved).toBeDefined();
    expect(retrieved!.metadata).toEqual(metadata2);
  });

  test("should accept multiple vectors with single metadata", async () => {
    const vectors = [new Float32Array([0.1, 0.2]), new Float32Array([0.3, 0.4])];
    const metadata = { text: "Shared metadata" };

    const task = new ChunkVectorUpsertTask();
    const result = await task.run({
      dataset,
      doc_id: "doc1",
      vectors: vectors,
      metadata: metadata,
    });

    expect(result.count).toBe(2);
    expect(result.doc_id).toBe("doc1");
  });

  test("should handle quantized vectors (Int8Array)", async () => {
    const vector = new Int8Array([127, -128, 64, -64, 0]);
    const metadata = { text: "Quantized vector" };

    const task = new ChunkVectorUpsertTask();
    const result = await task.run({
      dataset,
      doc_id: "doc1",
      vectors: vector,
      metadata: metadata,
    });

    expect(result.count).toBe(1);

    const retrieved = await dataset.get(result.chunk_ids[0]);
    expect(retrieved).toBeDefined();
    expect(retrieved?.vector).toBeInstanceOf(Int8Array);
  });

  test("should handle metadata without optional fields", async () => {
    const vector = new Float32Array([0.1, 0.2, 0.3]);
    const metadata = { text: "Simple metadata" };

    const task = new ChunkVectorUpsertTask();
    const result = await task.run({
      dataset,
      doc_id: "doc1",
      vectors: vector,
      metadata: metadata,
    });

    expect(result.count).toBe(1);

    const retrieved = await dataset.get(result.chunk_ids[0]);
    expect(retrieved!.metadata).toEqual(metadata);
  });

  test("should handle large batch upsert", async () => {
    const count = 100;
    const vectors = Array.from(
      { length: count },
      (_, i) => new Float32Array([i * 0.01, i * 0.02, i * 0.03])
    );
    const metadata = { text: "Batch document" };

    const task = new ChunkVectorUpsertTask();
    const result = await task.run({
      dataset,
      doc_id: "batch-doc",
      vectors: vectors,
      metadata: metadata,
    });

    expect(result.count).toBe(count);
    expect(result.chunk_ids).toHaveLength(count);

    const size = await dataset.size();
    expect(size).toBe(count);
  });

  test("should resolve repository from string ID", async () => {
    // Register dataset by ID
    registerDocumentChunkDataset("test-upsert-repo", dataset);

    const vector = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    const metadata = { text: "Test document", source: "test.txt" };

    const task = new ChunkVectorUpsertTask();
    // Pass repository as string ID instead of instance
    const result = await task.run({
      dataset: "test-upsert-repo",
      doc_id: "doc1",
      vectors: vector,
      metadata: metadata,
    });

    expect(result.count).toBe(1);
    expect(result.doc_id).toBe("doc1");

    // Verify vector was stored
    const retrieved = await dataset.get(result.chunk_ids[0]);
    expect(retrieved).toBeDefined();
    expect(retrieved?.doc_id).toBe("doc1");
    expect(retrieved!.metadata).toEqual(metadata);
  });
});
