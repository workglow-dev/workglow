/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Document,
  DocumentChunk,
  DocumentChunkDataset,
  DocumentChunkPrimaryKey,
  DocumentChunkSchema,
  DocumentDataset,
  DocumentStorageKey,
  DocumentStorageSchema,
  NodeKind,
  StructuralParser,
} from "@workglow/dataset";
import { InMemoryTabularStorage, InMemoryVectorStorage } from "@workglow/storage";
import { uuid4 } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";

describe("DocumentDataset", () => {
  let dataset: DocumentDataset;
  let vectorDataset: DocumentChunkDataset;

  beforeEach(async () => {
    const tabularStorage = new InMemoryTabularStorage<DocumentStorageSchema, DocumentStorageKey>(
      DocumentStorageSchema,
      DocumentStorageKey
    );
    await tabularStorage.setupDatabase();

    const storage = new InMemoryVectorStorage<
      typeof DocumentChunkSchema,
      typeof DocumentChunkPrimaryKey,
      Record<string, unknown>,
      Float32Array,
      DocumentChunk
    >(DocumentChunkSchema, DocumentChunkPrimaryKey, [], 3, Float32Array);
    await storage.setupDatabase();
    vectorDataset = new DocumentChunkDataset(storage);

    dataset = new DocumentDataset(tabularStorage, vectorDataset as any);
  });

  it("should store and retrieve documents", async () => {
    const markdown = "# Test\n\nContent.";
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test Document" });

    await dataset.upsert(doc);
    const retrieved = await dataset.get(doc_id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.doc_id).toBe(doc_id);
    expect(retrieved?.metadata.title).toBe("Test Document");
  });

  it("should retrieve nodes by ID", async () => {
    const markdown = "# Section\n\nParagraph.";
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });
    await dataset.upsert(doc);

    // Get a child node
    const firstChild = root.children[0];
    const retrieved = await dataset.getNode(doc_id, firstChild.nodeId);

    expect(retrieved).toBeDefined();
    expect(retrieved?.nodeId).toBe(firstChild.nodeId);
  });

  it("should get ancestors of a node", async () => {
    const markdown = `# Section 1

## Subsection 1.1

Paragraph.`;

    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });
    await dataset.upsert(doc);

    // Find a deeply nested node
    const section = root.children.find((c) => c.kind === NodeKind.SECTION);
    expect(section).toBeDefined();

    const subsection = (section as any).children.find((c: any) => c.kind === NodeKind.SECTION);
    expect(subsection).toBeDefined();

    const ancestors = await dataset.getAncestors(doc_id, subsection.nodeId);

    // Should include root, section, and subsection
    expect(ancestors.length).toBeGreaterThanOrEqual(3);
    expect(ancestors[0].nodeId).toBe(root.nodeId);
    expect(ancestors[1].nodeId).toBe(section!.nodeId);
    expect(ancestors[2].nodeId).toBe(subsection.nodeId);
  });

  it("should handle chunks", async () => {
    const markdown = "# Test\n\nContent.";
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });

    // Add chunks
    const chunks = [
      {
        chunkId: "chunk_1",
        doc_id,
        text: "Test chunk",
        nodePath: [root.nodeId],
        depth: 1,
      },
    ];

    doc.setChunks(chunks);

    await dataset.upsert(doc);

    // Retrieve chunks
    const retrievedChunks = await dataset.getChunks(doc_id);
    expect(retrievedChunks).toBeDefined();
    expect(retrievedChunks.length).toBe(1);
  });

  it("should list all documents", async () => {
    const markdown1 = "# Doc 1";
    const markdown2 = "# Doc 2";

    const id1 = uuid4();
    const id2 = uuid4();

    const root1 = await StructuralParser.parseMarkdown(id1, markdown1, "Doc 1");
    const root2 = await StructuralParser.parseMarkdown(id2, markdown2, "Doc 2");

    const doc1 = new Document(id1, root1, { title: "Doc 1" });
    const doc2 = new Document(id2, root2, { title: "Doc 2" });

    await dataset.upsert(doc1);
    await dataset.upsert(doc2);

    const list = await dataset.list();
    expect(list.length).toBe(2);
    expect(list).toContain(id1);
    expect(list).toContain(id2);
  });

  it("should delete documents", async () => {
    const markdown = "# Test";
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });
    await dataset.upsert(doc);

    expect(await dataset.get(doc_id)).toBeDefined();

    await dataset.delete(doc_id);

    expect(await dataset.get(doc_id)).toBeUndefined();
  });

  it("should return undefined for non-existent document", async () => {
    const result = await dataset.get("non-existent-doc-id");
    expect(result).toBeUndefined();
  });

  it("should return undefined for node in non-existent document", async () => {
    const result = await dataset.getNode("non-existent-doc-id", "some-node-id");
    expect(result).toBeUndefined();
  });

  it("should return undefined for non-existent node", async () => {
    const markdown = "# Test";
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });
    await dataset.upsert(doc);

    const result = await dataset.getNode(doc_id, "non-existent-node-id");
    expect(result).toBeUndefined();
  });

  it("should return empty array for ancestors of non-existent document", async () => {
    const result = await dataset.getAncestors("non-existent-doc-id", "some-node-id");
    expect(result).toEqual([]);
  });

  it("should return empty array for ancestors of non-existent node", async () => {
    const markdown = "# Test";
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });
    await dataset.upsert(doc);

    const result = await dataset.getAncestors(doc_id, "non-existent-node-id");
    expect(result).toEqual([]);
  });

  it("should return empty array for chunks of non-existent document", async () => {
    const result = await dataset.getChunks("non-existent-doc-id");
    expect(result).toEqual([]);
  });

  it("should return empty list for empty repository", async () => {
    // Create fresh empty repo
    const tabularStorage = new InMemoryTabularStorage<DocumentStorageSchema, DocumentStorageKey>(
      DocumentStorageSchema,
      DocumentStorageKey
    );
    await tabularStorage.setupDatabase();
    const emptyDataset = new DocumentDataset(tabularStorage);

    const result = await emptyDataset.list();
    expect(result).toEqual([]);
  });

  it("should not throw when deleting non-existent document", async () => {
    // Just verify delete completes without error
    await dataset.delete("non-existent-doc-id");
    // If we get here, it didn't throw
    expect(true).toBe(true);
  });

  it("should update existing document on upsert", async () => {
    const markdown = "# Test";
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc1 = new Document(doc_id, root, { title: "Original Title" });
    await dataset.upsert(doc1);

    const doc2 = new Document(doc_id, root, { title: "Updated Title" });
    await dataset.upsert(doc2);

    const retrieved = await dataset.get(doc_id);
    expect(retrieved?.metadata.title).toBe("Updated Title");

    const list = await dataset.list();
    expect(list.length).toBe(1);
  });

  it("should find chunks by node ID", async () => {
    const markdown = "# Test\n\nContent.";
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });

    const chunks = [
      {
        chunkId: "chunk_1",
        doc_id,
        text: "First chunk",
        nodePath: [root.nodeId, "child-1"],
        depth: 2,
      },
      {
        chunkId: "chunk_2",
        doc_id,
        text: "Second chunk",
        nodePath: [root.nodeId, "child-2"],
        depth: 2,
      },
    ];
    doc.setChunks(chunks);
    await dataset.upsert(doc);

    const result = await dataset.findChunksByNodeId(doc_id, root.nodeId);
    expect(result.length).toBe(2);
  });

  it("should return empty array for findChunksByNodeId with no matches", async () => {
    const markdown = "# Test";
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });
    doc.setChunks([]);
    await dataset.upsert(doc);

    const result = await dataset.findChunksByNodeId(doc_id, "non-matching-node");
    expect(result).toEqual([]);
  });

  it("should return empty array for findChunksByNodeId with non-existent document", async () => {
    const result = await dataset.findChunksByNodeId("non-existent-doc", "some-node");
    expect(result).toEqual([]);
  });

  it("should search with vector storage", async () => {
    // Add vectors to vector storage
    await vectorDataset.put({
      chunk_id: "chunk_1",
      doc_id: "doc1",
      vector: new Float32Array([1.0, 0.0, 0.0]),
      metadata: { text: "First chunk" },
    });
    await vectorDataset.put({
      chunk_id: "chunk_2",
      doc_id: "doc1",
      vector: new Float32Array([0.8, 0.2, 0.0]),
      metadata: { text: "Second chunk" },
    });
    await vectorDataset.put({
      chunk_id: "chunk_3",
      doc_id: "doc2",
      vector: new Float32Array([0.0, 1.0, 0.0]),
      metadata: { text: "Third chunk" },
    });

    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const results = await dataset.search(queryVector, { topK: 2 });

    expect(results.length).toBe(2);
    expect(results[0].chunk_id).toBe("chunk_1");
  });

  it("should search with score threshold", async () => {
    await vectorDataset.put({
      chunk_id: "chunk_1",
      doc_id: "doc1",
      vector: new Float32Array([1.0, 0.0, 0.0]),
      metadata: { text: "Matching chunk" },
    });
    await vectorDataset.put({
      chunk_id: "chunk_2",
      doc_id: "doc1",
      vector: new Float32Array([0.0, 1.0, 0.0]),
      metadata: { text: "Non-matching chunk" },
    });

    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const results = await dataset.search(queryVector, { topK: 10, scoreThreshold: 0.9 });

    expect(results.length).toBeGreaterThanOrEqual(1);
    results.forEach((r: any) => {
      expect(r.score).toBeGreaterThanOrEqual(0.9);
    });
  });

  it("should return empty array for search when no vector storage configured", async () => {
    const tabularStorage = new InMemoryTabularStorage<DocumentStorageSchema, DocumentStorageKey>(
      DocumentStorageSchema,
      DocumentStorageKey
    );
    await tabularStorage.setupDatabase();

    const datasetWithoutVector = new DocumentDataset(tabularStorage);

    const queryVector = new Float32Array([1.0, 0.0, 0.0]);
    const results = await datasetWithoutVector.search(queryVector);

    expect(results).toEqual([]);
  });
});

describe("Document", () => {
  it("should manage chunks", async () => {
    const markdown = "# Test";
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });

    const chunks = [
      {
        chunkId: "chunk_1",
        doc_id,
        text: "Chunk 1",
        nodePath: [root.nodeId],
        depth: 1,
      },
    ];
    doc.setChunks(chunks);

    const retrievedChunks = doc.getChunks();
    expect(retrievedChunks.length).toBe(1);
    expect(retrievedChunks[0].text).toBe("Chunk 1");
  });

  it("should serialize and deserialize", async () => {
    const markdown = "# Test";
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });

    const chunks = [
      {
        chunkId: "chunk_1",
        doc_id,
        text: "Chunk",
        nodePath: [root.nodeId],
        depth: 1,
      },
    ];
    doc.setChunks(chunks);

    // Serialize
    const json = doc.toJSON();

    // Deserialize
    const restored = Document.fromJSON(JSON.stringify(json));

    expect(restored.doc_id).toBe(doc.doc_id);
    expect(restored.metadata.title).toBe(doc.metadata.title);
    expect(restored.getChunks().length).toBe(1);
  });

  it("should find chunks by nodeId", async () => {
    const markdown = "# Test";
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });

    const chunks = [
      {
        chunkId: "chunk_1",
        doc_id,
        text: "First",
        nodePath: ["root", "section-a"],
        depth: 2,
      },
      {
        chunkId: "chunk_2",
        doc_id,
        text: "Second",
        nodePath: ["root", "section-b"],
        depth: 2,
      },
      {
        chunkId: "chunk_3",
        doc_id,
        text: "Third",
        nodePath: ["root", "section-a", "subsection"],
        depth: 3,
      },
    ];
    doc.setChunks(chunks);

    // Find chunks containing "section-a"
    const result = doc.findChunksByNodeId("section-a");
    expect(result.length).toBe(2);
    expect(result.map((c) => c.chunkId)).toContain("chunk_1");
    expect(result.map((c) => c.chunkId)).toContain("chunk_3");
  });

  it("should return empty array when no chunks match nodeId", async () => {
    const markdown = "# Test";
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });

    const chunks = [
      {
        chunkId: "chunk_1",
        doc_id,
        text: "First",
        nodePath: ["root", "section-a"],
        depth: 2,
      },
    ];
    doc.setChunks(chunks);

    const result = doc.findChunksByNodeId("non-existent-node");
    expect(result).toEqual([]);
  });

  it("should handle empty chunks in findChunksByNodeId", async () => {
    const markdown = "# Test";
    const doc_id = uuid4();
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });
    doc.setChunks([]);

    const result = doc.findChunksByNodeId("any-node");
    expect(result).toEqual([]);
  });
});
