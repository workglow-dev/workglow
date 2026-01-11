/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Document,
  DocumentRepository,
  DocumentStorageKey,
  DocumentStorageSchema,
  InMemoryDocumentChunkVectorRepository,
  InMemoryTabularRepository,
  NodeIdGenerator,
  NodeKind,
  StructuralParser,
} from "@workglow/storage";
import { beforeEach, describe, expect, it } from "vitest";

describe("DocumentRepository", () => {
  let repo: DocumentRepository;

  beforeEach(async () => {
    const tabularStorage = new InMemoryTabularRepository<DocumentStorageSchema, DocumentStorageKey>(
      DocumentStorageSchema,
      DocumentStorageKey
    );
    await tabularStorage.setupDatabase();

    const vectorStorage = new InMemoryDocumentChunkVectorRepository(3);
    await vectorStorage.setupDatabase();

    repo = new DocumentRepository(tabularStorage, vectorStorage);
  });

  it("should store and retrieve documents", async () => {
    const markdown = "# Test\n\nContent.";
    const doc_id = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test Document" });

    await repo.upsert(doc);
    const retrieved = await repo.get(doc_id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.doc_id).toBe(doc_id);
    expect(retrieved?.metadata.title).toBe("Test Document");
  });

  it("should retrieve nodes by ID", async () => {
    const markdown = "# Section\n\nParagraph.";
    const doc_id = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });
    await repo.upsert(doc);

    // Get a child node
    const firstChild = root.children[0];
    const retrieved = await repo.getNode(doc_id, firstChild.nodeId);

    expect(retrieved).toBeDefined();
    expect(retrieved?.nodeId).toBe(firstChild.nodeId);
  });

  it("should get ancestors of a node", async () => {
    const markdown = `# Section 1

## Subsection 1.1

Paragraph.`;

    const doc_id = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });
    await repo.upsert(doc);

    // Find a deeply nested node
    const section = root.children.find((c) => c.kind === NodeKind.SECTION);
    expect(section).toBeDefined();

    const subsection = (section as any).children.find((c: any) => c.kind === NodeKind.SECTION);
    expect(subsection).toBeDefined();

    const ancestors = await repo.getAncestors(doc_id, subsection.nodeId);

    // Should include root, section, and subsection
    expect(ancestors.length).toBeGreaterThanOrEqual(3);
    expect(ancestors[0].nodeId).toBe(root.nodeId);
    expect(ancestors[1].nodeId).toBe(section!.nodeId);
    expect(ancestors[2].nodeId).toBe(subsection.nodeId);
  });

  it("should handle chunks", async () => {
    const markdown = "# Test\n\nContent.";
    const doc_id = await NodeIdGenerator.generateDocId("test", markdown);
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

    await repo.upsert(doc);

    // Retrieve chunks
    const retrievedChunks = await repo.getChunks(doc_id);
    expect(retrievedChunks).toBeDefined();
    expect(retrievedChunks.length).toBe(1);
  });

  it("should list all documents", async () => {
    const markdown1 = "# Doc 1";
    const markdown2 = "# Doc 2";

    const id1 = await NodeIdGenerator.generateDocId("test1", markdown1);
    const id2 = await NodeIdGenerator.generateDocId("test2", markdown2);

    const root1 = await StructuralParser.parseMarkdown(id1, markdown1, "Doc 1");
    const root2 = await StructuralParser.parseMarkdown(id2, markdown2, "Doc 2");

    const doc1 = new Document(id1, root1, { title: "Doc 1" });
    const doc2 = new Document(id2, root2, { title: "Doc 2" });

    await repo.upsert(doc1);
    await repo.upsert(doc2);

    const list = await repo.list();
    expect(list.length).toBe(2);
    expect(list).toContain(id1);
    expect(list).toContain(id2);
  });

  it("should delete documents", async () => {
    const markdown = "# Test";
    const doc_id = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(doc_id, markdown, "Test");

    const doc = new Document(doc_id, root, { title: "Test" });
    await repo.upsert(doc);

    expect(await repo.get(doc_id)).toBeDefined();

    await repo.delete(doc_id);

    expect(await repo.get(doc_id)).toBeUndefined();
  });
});

describe("Document", () => {
  it("should manage chunks", async () => {
    const markdown = "# Test";
    const doc_id = await NodeIdGenerator.generateDocId("test", markdown);
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
    const doc_id = await NodeIdGenerator.generateDocId("test", markdown);
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
});
