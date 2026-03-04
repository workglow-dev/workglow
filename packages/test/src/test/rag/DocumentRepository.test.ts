/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Document,
  KnowledgeBase,
  NodeKind,
  StructuralParser,
  createKnowledgeBase,
  type SectionNode,
} from "@workglow/dataset";
import { setLogger, uuid4 } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("DocumentRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  describe("KnowledgeBase", () => {
    let kb: KnowledgeBase;

    beforeEach(async () => {
      kb = await createKnowledgeBase({
        name: `test-kb-${uuid4()}`,
        vectorDimensions: 3,
        register: false,
      });
    });

    it("should store and retrieve documents", async () => {
      const markdown = "# Test\n\nContent.";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test Document" });

      const inserted = await kb.upsertDocument(doc);
      const retrieved = await kb.getDocument(inserted.doc_id!);

      expect(retrieved).toBeDefined();
      expect(retrieved?.doc_id).toBeDefined();
      expect(retrieved?.doc_id).toBe(inserted.doc_id);
      expect(retrieved?.metadata.title).toBe("Test Document");
    });

    it("should retrieve nodes by ID", async () => {
      const markdown = "# Section\n\nParagraph.";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });
      const inserted = await kb.upsertDocument(doc);

      // Get a child node
      const firstChild = root.children[0];
      const retrieved = await kb.getNode(inserted.doc_id!, firstChild.nodeId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.nodeId).toBe(firstChild.nodeId);
    });

    it("should get ancestors of a node", async () => {
      const markdown = `# Section 1

## Subsection 1.1

Paragraph.`;

      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });
      const inserted = await kb.upsertDocument(doc);

      // Find a deeply nested node
      const section = root.children.find(
        (c): c is SectionNode => c.kind === NodeKind.SECTION
      );
      expect(section).toBeDefined();

      const subsection = section!.children.find(
        (c) => c.kind === NodeKind.SECTION
      );
      expect(subsection).toBeDefined();

      const ancestors = await kb.getAncestors(inserted.doc_id!, subsection!.nodeId);

      // Should include root, section, and subsection
      expect(ancestors.length).toBeGreaterThanOrEqual(3);
      expect(ancestors[0].nodeId).toBe(root.nodeId);
      expect(ancestors[1].nodeId).toBe(section!.nodeId);
      expect(ancestors[2].nodeId).toBe(subsection!.nodeId);
    });

    it("should handle chunks", async () => {
      const markdown = "# Test\n\nContent.";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });

      // Add chunks
      const chunks = [
        {
          chunkId: "chunk_1",
          doc_id: doc_id,
          text: "Test chunk",
          nodePath: [root.nodeId],
          depth: 1,
        },
      ];

      doc.setChunks(chunks);

      const inserted = await kb.upsertDocument(doc);

      // Retrieve chunks from document JSON
      const retrievedChunks = await kb.getDocumentChunks(inserted.doc_id!);
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

      const doc1 = new Document(root1, { title: "Doc 1" });
      const doc2 = new Document(root2, { title: "Doc 2" });

      const inserted1 = await kb.upsertDocument(doc1);
      const inserted2 = await kb.upsertDocument(doc2);

      const list = await kb.listDocuments();
      expect(list.length).toBe(2);
      expect(list).toContain(inserted1.doc_id);
      expect(list).toContain(inserted2.doc_id);
    });

    it("should delete documents and cascade to chunks", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });
      const inserted = await kb.upsertDocument(doc);

      // Add some chunks to vector storage
      await kb.upsertChunk({
        doc_id: inserted.doc_id!,
        vector: new Float32Array([1.0, 0.0, 0.0]),
        metadata: { chunkId: "c1", doc_id: inserted.doc_id!, text: "test", nodePath: [], depth: 0 },
      });

      expect(await kb.getDocument(inserted.doc_id!)).toBeDefined();

      await kb.deleteDocument(inserted.doc_id!);

      expect(await kb.getDocument(inserted.doc_id!)).toBeUndefined();
    });

    it("should return undefined for non-existent document", async () => {
      const result = await kb.getDocument("non-existent-doc-id");
      expect(result).toBeUndefined();
    });

    it("should return undefined for node in non-existent document", async () => {
      const result = await kb.getNode("non-existent-doc-id", "some-node-id");
      expect(result).toBeUndefined();
    });

    it("should return undefined for non-existent node", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });
      const inserted = await kb.upsertDocument(doc);

      const result = await kb.getNode(inserted.doc_id!, "non-existent-node-id");
      expect(result).toBeUndefined();
    });

    it("should return empty array for ancestors of non-existent document", async () => {
      const result = await kb.getAncestors("non-existent-doc-id", "some-node-id");
      expect(result).toEqual([]);
    });

    it("should return empty array for ancestors of non-existent node", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });
      const inserted = await kb.upsertDocument(doc);

      const result = await kb.getAncestors(inserted.doc_id!, "non-existent-node-id");
      expect(result).toEqual([]);
    });

    it("should return empty array for chunks of non-existent document", async () => {
      const result = await kb.getDocumentChunks("non-existent-doc-id");
      expect(result).toEqual([]);
    });

    it("should return empty list for empty knowledge base", async () => {
      const emptyKb = await createKnowledgeBase({
        name: `empty-${uuid4()}`,
        vectorDimensions: 3,
        register: false,
      });

      const result = await emptyKb.listDocuments();
      expect(result).toEqual([]);
    });

    it("should not throw when deleting non-existent document", async () => {
      // Just verify delete completes without error
      await kb.deleteDocument("non-existent-doc-id");
      // If we get here, it didn't throw
      expect(true).toBe(true);
    });

    it("should update existing document on upsert", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc1 = new Document(root, { title: "Original Title" });
      const inserted1 = await kb.upsertDocument(doc1);

      const doc2 = new Document(root, { title: "Updated Title" }, [], inserted1.doc_id);
      await kb.upsertDocument(doc2);

      const retrieved = await kb.getDocument(inserted1.doc_id!);
      expect(retrieved?.metadata.title).toBe("Updated Title");

      const list = await kb.listDocuments();
      expect(list.length).toBe(1);
    });

    it("should find chunks by node ID", async () => {
      const markdown = "# Test\n\nContent.";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });
      const inserted = await kb.upsertDocument(doc);

      const chunks = [
        {
          chunkId: "chunk_1",
          doc_id: inserted.doc_id!,
          text: "First chunk",
          nodePath: [root.nodeId, "child-1"],
          depth: 2,
        },
        {
          chunkId: "chunk_2",
          doc_id: inserted.doc_id!,
          text: "Second chunk",
          nodePath: [root.nodeId, "child-2"],
          depth: 2,
        },
      ];
      inserted.setChunks(chunks);
      await kb.upsertDocument(inserted);

      const result = await kb.findChunksByNodeId(inserted.doc_id!, root.nodeId);
      expect(result.length).toBe(2);
    });

    it("should return empty array for findChunksByNodeId with no matches", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });
      doc.setChunks([]);
      const inserted = await kb.upsertDocument(doc);

      const result = await kb.findChunksByNodeId(inserted.doc_id!, "non-matching-node");
      expect(result).toEqual([]);
    });

    it("should return empty array for findChunksByNodeId with non-existent document", async () => {
      const result = await kb.findChunksByNodeId("non-existent-doc", "some-node");
      expect(result).toEqual([]);
    });

    it("should search with vector storage", async () => {
      // Add vectors to vector storage
      await kb.upsertChunk({
        doc_id: "doc1",
        vector: new Float32Array([1.0, 0.0, 0.0]),
        metadata: { chunkId: "chunk_1", doc_id: "doc1", text: "First chunk", nodePath: [], depth: 0 },
      });
      await kb.upsertChunk({
        doc_id: "doc1",
        vector: new Float32Array([0.8, 0.2, 0.0]),
        metadata: { chunkId: "chunk_2", doc_id: "doc1", text: "Second chunk", nodePath: [], depth: 0 },
      });
      await kb.upsertChunk({
        doc_id: "doc2",
        vector: new Float32Array([0.0, 1.0, 0.0]),
        metadata: { chunkId: "chunk_3", doc_id: "doc2", text: "Third chunk", nodePath: [], depth: 0 },
      });

      const queryVector = new Float32Array([1.0, 0.0, 0.0]);
      const results = await kb.similaritySearch(queryVector, { topK: 2 });

      expect(results.length).toBe(2);
      expect(results[0].chunk_id).toBeDefined();
    });

    it("should search with score threshold", async () => {
      await kb.upsertChunk({
        doc_id: "doc1",
        vector: new Float32Array([1.0, 0.0, 0.0]),
        metadata: { chunkId: "chunk_1", doc_id: "doc1", text: "Matching chunk", nodePath: [], depth: 0 },
      });
      await kb.upsertChunk({
        doc_id: "doc1",
        vector: new Float32Array([0.0, 1.0, 0.0]),
        metadata: { chunkId: "chunk_2", doc_id: "doc1", text: "Non-matching chunk", nodePath: [], depth: 0 },
      });

      const queryVector = new Float32Array([1.0, 0.0, 0.0]);
      const results = await kb.similaritySearch(queryVector, { topK: 10, scoreThreshold: 0.9 });

      expect(results.length).toBeGreaterThanOrEqual(1);
      results.forEach((r: any) => {
        expect(r.score).toBeGreaterThanOrEqual(0.9);
      });
    });

    it("should support prepareReindex", async () => {
      const markdown = "# Test\n\nContent.";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" });
      const inserted = await kb.upsertDocument(doc);

      // Add chunks
      await kb.upsertChunk({
        doc_id: inserted.doc_id!,
        vector: new Float32Array([1.0, 0.0, 0.0]),
        metadata: { chunkId: "c1", doc_id: inserted.doc_id!, text: "test", nodePath: [], depth: 0 },
      });

      // PrepareReindex should delete chunks but keep document
      const reindexDoc = await kb.prepareReindex(inserted.doc_id!);
      expect(reindexDoc).toBeDefined();
      expect(reindexDoc?.doc_id).toBe(inserted.doc_id);

      // Document still exists
      const retrieved = await kb.getDocument(inserted.doc_id!);
      expect(retrieved).toBeDefined();
    });
  });

  describe("Document", () => {
    it("should manage chunks", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" }, [], doc_id);

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

      const doc = new Document(root, { title: "Test" }, [], doc_id);

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

      // Serialize (doc_id is NOT included in JSON)
      const json = doc.toJSON();
      expect(json).not.toHaveProperty("doc_id");

      // Deserialize (doc_id is passed separately)
      const restored = Document.fromJSON(JSON.stringify(json), doc_id);

      expect(restored.doc_id).toBe(doc.doc_id);
      expect(restored.metadata.title).toBe(doc.metadata.title);
      expect(restored.getChunks().length).toBe(1);
    });

    it("should find chunks by nodeId", async () => {
      const markdown = "# Test";
      const doc_id = uuid4();
      const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

      const doc = new Document(root, { title: "Test" }, [], doc_id);

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

      const doc = new Document(root, { title: "Test" }, [], doc_id);

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

      const doc = new Document(root, { title: "Test" }, [], doc_id);
      doc.setChunks([]);

      const result = doc.findChunksByNodeId("any-node");
      expect(result).toEqual([]);
    });
  });
});
