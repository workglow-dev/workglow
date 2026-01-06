/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { VectorStoreUpsertTask } from "@workglow/ai";
import { InMemoryVectorRepository, registerVectorRepository } from "@workglow/storage";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("VectorStoreUpsertTask", () => {
  let repo: InMemoryVectorRepository<{ text: string; source?: string }>;

  beforeEach(async () => {
    repo = new InMemoryVectorRepository<{ text: string; source?: string }>();
    await repo.setupDatabase();
  });

  afterEach(() => {
    repo.destroy();
  });

  test("should upsert a single vector", async () => {
    const vector = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    const metadata = { text: "Test document", source: "test.txt" };

    const task = new VectorStoreUpsertTask();
    const result = await task.run({
      repository: repo,
      ids: "doc1",
      vectors: [vector],
      metadata: metadata,
    });

    expect(result.count).toBe(1);
    expect(result.ids).toEqual(["doc1"]);

    // Verify vector was stored
    const retrieved = await repo.get("doc1");
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe("doc1");
    expect(retrieved?.metadata).toEqual(metadata);
    expect(retrieved?.vector).toEqual(vector);
  });

  test("should upsert multiple vectors in bulk", async () => {
    const vectors = [
      new Float32Array([0.1, 0.2, 0.3]),
      new Float32Array([0.4, 0.5, 0.6]),
      new Float32Array([0.7, 0.8, 0.9]),
    ];
    const metadata = [
      { text: "Document 1", source: "doc1.txt" },
      { text: "Document 2", source: "doc2.txt" },
      { text: "Document 3", source: "doc3.txt" },
    ];

    const task = new VectorStoreUpsertTask();
    const result = await task.run({
      repository: repo,
      ids: ["doc1", "doc2", "doc3"],
      vectors: vectors,
      metadata: metadata,
    });

    expect(result.count).toBe(3);
    expect(result.ids).toEqual(["doc1", "doc2", "doc3"]);

    // Verify all vectors were stored
    for (let i = 0; i < 3; i++) {
      const retrieved = await repo.get(`doc${i + 1}`);
      expect(retrieved).toBeDefined();
      expect(retrieved?.metadata).toEqual(metadata[i]);
      expect(retrieved?.vector).toEqual(vectors[i]);
    }
  });

  test("should handle array of single item (normalized to bulk)", async () => {
    const vector = new Float32Array([0.1, 0.2, 0.3]);
    const metadata = { text: "Single item as array" };

    const task = new VectorStoreUpsertTask();
    const result = await task.run({
      repository: repo,
      ids: ["doc1"],
      vectors: [vector],
      metadata: [metadata],
    });

    expect(result.count).toBe(1);
    expect(result.ids).toEqual(["doc1"]);

    const retrieved = await repo.get("doc1");
    expect(retrieved).toBeDefined();
    expect(retrieved?.metadata).toEqual(metadata);
  });

  test("should update existing vector when upserting with same ID", async () => {
    const vector1 = new Float32Array([0.1, 0.2, 0.3]);
    const vector2 = new Float32Array([0.9, 0.8, 0.7]);
    const metadata1 = { text: "Original document" };
    const metadata2 = { text: "Updated document", source: "updated.txt" };

    // First upsert
    const task1 = new VectorStoreUpsertTask();
    await task1.run({
      repository: repo,
      ids: "doc1",
      vectors: [vector1],
      metadata: metadata1,
    });

    // Update with same ID
    const task2 = new VectorStoreUpsertTask();
    await task2.run({
      repository: repo,
      ids: "doc1",
      vectors: [vector2],
      metadata: metadata2,
    });

    const retrieved = await repo.get("doc1");
    expect(retrieved).toBeDefined();
    expect(retrieved?.vector).toEqual(vector2);
    expect(retrieved?.metadata).toEqual(metadata2);
  });

  test("should throw error on mismatched array lengths", async () => {
    const vectors = [new Float32Array([0.1, 0.2]), new Float32Array([0.3, 0.4])];
    const metadata = [{ text: "Only one metadata" }];

    const task = new VectorStoreUpsertTask();
    await expect(
      task.run({
        repository: repo,
        ids: ["doc1", "doc2"],
        vectors: vectors,
        metadata: metadata,
      })
    ).rejects.toThrow("Mismatched array lengths");
  });

  test("should handle quantized vectors (Int8Array)", async () => {
    const vector = new Int8Array([127, -128, 64, -64, 0]);
    const metadata = { text: "Quantized vector" };

    const task = new VectorStoreUpsertTask();
    const result = await task.run({
      repository: repo,
      ids: "doc1",
      vectors: [vector],
      metadata: metadata,
    });

    expect(result.count).toBe(1);

    const retrieved = await repo.get("doc1");
    expect(retrieved).toBeDefined();
    expect(retrieved?.vector).toBeInstanceOf(Int8Array);
    expect(retrieved?.vector).toEqual(vector);
  });

  test("should handle metadata without optional fields", async () => {
    const vector = new Float32Array([0.1, 0.2, 0.3]);
    const metadata = { text: "Simple metadata" };

    const task = new VectorStoreUpsertTask();
    const result = await task.run({
      repository: repo,
      ids: "doc1",
      vectors: [vector],
      metadata: metadata,
    });

    expect(result.count).toBe(1);

    const retrieved = await repo.get("doc1");
    expect(retrieved?.metadata).toEqual(metadata);
  });

  test("should handle large batch upsert", async () => {
    const count = 100;
    const vectors = Array.from(
      { length: count },
      (_, i) => new Float32Array([i * 0.01, i * 0.02, i * 0.03])
    );
    const metadata = Array.from({ length: count }, (_, i) => ({
      text: `Document ${i + 1}`,
    }));
    const ids = Array.from({ length: count }, (_, i) => `doc${i + 1}`);

    const task = new VectorStoreUpsertTask();
    const result = await task.run({
      repository: repo,
      ids: ids,
      vectors: vectors,
      metadata: metadata,
    });

    expect(result.count).toBe(count);
    expect(result.ids).toHaveLength(count);

    const size = await repo.size();
    expect(size).toBe(count);
  });

  test("should resolve repository from string ID", async () => {
    // Register repository by ID
    registerVectorRepository("test-upsert-repo", repo);

    const vector = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    const metadata = { text: "Test document", source: "test.txt" };

    const task = new VectorStoreUpsertTask();
    // Pass repository as string ID instead of instance
    const result = await task.run({
      repository: "test-upsert-repo" as any,
      ids: "doc1",
      vectors: [vector],
      metadata: metadata,
    });

    expect(result.count).toBe(1);
    expect(result.ids).toEqual(["doc1"]);

    // Verify vector was stored
    const retrieved = await repo.get("doc1");
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe("doc1");
    expect(retrieved?.metadata).toEqual(metadata);
    expect(retrieved?.vector).toEqual(vector);
  });
});
