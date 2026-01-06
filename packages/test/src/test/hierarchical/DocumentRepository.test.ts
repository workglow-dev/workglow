/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  deriveConfigId,
  Document,
  extractConfigFields,
  NodeIdGenerator,
  NodeKind,
  StructuralParser,
} from "@workglow/ai";
import { InMemoryDocumentRepository } from "@workglow/storage";
import { describe, expect, it } from "vitest";

describe("InMemoryDocumentRepository", () => {
  it("should store and retrieve master documents", async () => {
    const repo = new InMemoryDocumentRepository();
    await repo.setupDatabase();

    const markdown = "# Test\n\nContent.";
    const docId = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Test");

    const doc = new Document(docId, root, { title: "Test Document" });

    await repo.upsert(doc);
    const retrieved = await repo.get(docId);

    expect(retrieved).toBeDefined();
    expect(retrieved?.docId).toBe(docId);
    expect(retrieved?.metadata.title).toBe("Test Document");
  });

  it("should retrieve nodes by ID", async () => {
    const repo = new InMemoryDocumentRepository();
    await repo.setupDatabase();

    const markdown = "# Section\n\nParagraph.";
    const docId = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Test");

    const doc = new Document(docId, root, { title: "Test" });
    await repo.upsert(doc);

    // Get a child node
    const firstChild = root.children[0];
    const retrieved = await repo.getNode(docId, firstChild.nodeId);

    expect(retrieved).toBeDefined();
    expect(retrieved?.nodeId).toBe(firstChild.nodeId);
  });

  it("should get ancestors of a node", async () => {
    const repo = new InMemoryDocumentRepository();
    await repo.setupDatabase();

    const markdown = `# Section 1

## Subsection 1.1

Paragraph.`;

    const docId = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Test");

    const doc = new Document(docId, root, { title: "Test" });
    await repo.upsert(doc);

    // Find a deeply nested node
    const section = root.children.find((c) => c.kind === NodeKind.SECTION);
    expect(section).toBeDefined();

    const subsection = (section as any).children.find((c: any) => c.kind === NodeKind.SECTION);
    expect(subsection).toBeDefined();

    const ancestors = await repo.getAncestors(docId, subsection.nodeId);

    // Should include root, section, and subsection
    expect(ancestors.length).toBeGreaterThanOrEqual(3);
    expect(ancestors[0].nodeId).toBe(root.nodeId);
    expect(ancestors[1].nodeId).toBe(section!.nodeId);
    expect(ancestors[2].nodeId).toBe(subsection.nodeId);
  });

  it("should handle variants", async () => {
    const repo = new InMemoryDocumentRepository();
    await repo.setupDatabase();

    const markdown = "# Test\n\nContent.";
    const docId = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Test");

    const doc = new Document(docId, root, { title: "Test" });

    // Add a variant
    const provenance = {
      embeddingModel: "test-model",
      chunkerStrategy: "hierarchical",
      maxTokens: 512,
      overlap: 50,
    };

    const chunks = [
      {
        chunkId: "chunk_1",
        docId,
        configId: await deriveConfigId(provenance),
        text: "Test chunk",
        nodePath: [root.nodeId],
        depth: 1,
      },
    ];

    const configId = await doc.addVariant(provenance, chunks);

    await repo.upsert(doc);

    // Retrieve variant
    const variant = await repo.getVariant(docId, configId);
    expect(variant).toBeDefined();
    expect(variant?.chunks.length).toBe(1);
  });

  it("should list all documents", async () => {
    const repo = new InMemoryDocumentRepository();
    await repo.setupDatabase();

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
    const repo = new InMemoryDocumentRepository();
    await repo.setupDatabase();

    const markdown = "# Test";
    const docId = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Test");

    const doc = new Document(docId, root, { title: "Test" });
    await repo.upsert(doc);

    expect(await repo.get(docId)).toBeDefined();

    await repo.delete(docId);

    expect(await repo.get(docId)).toBeUndefined();
  });
});

describe("Provenance utilities", () => {
  it("should extract config fields from provenance", () => {
    const provenance = [
      {
        embeddingModel: "test-model",
        chunkerStrategy: "hierarchical",
        maxTokens: 512,
        overlap: 50,
        summaryModel: "summary-model",
        nerModel: "ner-model",
        randomField: "should be ignored",
      },
    ];

    const fields = extractConfigFields(provenance);

    expect(fields.embeddingModel).toBe("test-model");
    expect(fields.chunkerStrategy).toBe("hierarchical");
    expect(fields.maxTokens).toBe(512);
    expect(fields.overlap).toBe(50);
    expect(fields.summaryModel).toBe("summary-model");
    expect(fields.nerModel).toBe("ner-model");
  });

  it("should derive consistent configIds", async () => {
    const provenance1 = {
      embeddingModel: "model-1",
      chunkerStrategy: "hierarchical",
      maxTokens: 512,
      overlap: 50,
    };

    const provenance2 = {
      embeddingModel: "model-1",
      chunkerStrategy: "hierarchical",
      maxTokens: 512,
      overlap: 50,
    };

    const id1 = await deriveConfigId(provenance1);
    const id2 = await deriveConfigId(provenance2);

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^cfg_[0-9a-f]{16}$/);
  });

  it("should derive different configIds for different configs", async () => {
    const provenance1 = {
      embeddingModel: "model-1",
      chunkerStrategy: "hierarchical",
      maxTokens: 512,
      overlap: 50,
    };

    const provenance2 = {
      embeddingModel: "model-2",
      chunkerStrategy: "hierarchical",
      maxTokens: 512,
      overlap: 50,
    };

    const id1 = await deriveConfigId(provenance1);
    const id2 = await deriveConfigId(provenance2);

    expect(id1).not.toBe(id2);
  });

  it("should ignore field order in config derivation", async () => {
    const provenance1 = {
      embeddingModel: "model",
      maxTokens: 512,
      overlap: 50,
      chunkerStrategy: "hierarchical",
    };

    const provenance2 = {
      chunkerStrategy: "hierarchical",
      embeddingModel: "model",
      overlap: 50,
      maxTokens: 512,
    };

    const id1 = await deriveConfigId(provenance1);
    const id2 = await deriveConfigId(provenance2);

    expect(id1).toBe(id2);
  });
});

describe("Document", () => {
  it("should manage multiple variants", async () => {
    const markdown = "# Test";
    const docId = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Test");

    const doc = new Document(docId, root, { title: "Test" });

    // Add variant 1
    const prov1 = {
      embeddingModel: "model-1",
      chunkerStrategy: "hierarchical",
      maxTokens: 512,
      overlap: 50,
    };
    const chunks1 = [
      {
        chunkId: "chunk_1",
        docId,
        configId: await deriveConfigId(prov1),
        text: "Chunk 1",
        nodePath: [root.nodeId],
        depth: 1,
      },
    ];
    const configId1 = await doc.addVariant(prov1, chunks1);

    // Add variant 2
    const prov2 = {
      embeddingModel: "model-2",
      chunkerStrategy: "flat",
      maxTokens: 256,
      overlap: 25,
    };
    const chunks2 = [
      {
        chunkId: "chunk_2",
        docId,
        configId: await deriveConfigId(prov2),
        text: "Chunk 2",
        nodePath: [root.nodeId],
        depth: 1,
      },
    ];
    const configId2 = await doc.addVariant(prov2, chunks2);

    // Verify both variants exist
    expect(doc.hasVariant(configId1)).toBe(true);
    expect(doc.hasVariant(configId2)).toBe(true);

    const variant1 = doc.getVariant(configId1);
    const variant2 = doc.getVariant(configId2);

    expect(variant1?.chunks.length).toBe(1);
    expect(variant2?.chunks.length).toBe(1);
    expect(variant1?.chunks[0].text).toBe("Chunk 1");
    expect(variant2?.chunks[0].text).toBe("Chunk 2");
  });

  it("should serialize and deserialize", async () => {
    const markdown = "# Test";
    const docId = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Test");

    const doc = new Document(docId, root, { title: "Test" });

    const prov = {
      embeddingModel: "model",
      chunkerStrategy: "hierarchical",
      maxTokens: 512,
      overlap: 50,
    };
    const chunks = [
      {
        chunkId: "chunk_1",
        docId,
        configId: await deriveConfigId(prov),
        text: "Chunk",
        nodePath: [root.nodeId],
        depth: 1,
      },
    ];
    await doc.addVariant(prov, chunks);

    // Serialize
    const json = doc.toJSON();

    // Deserialize
    const restored = Document.fromJSON(json);

    expect(restored.docId).toBe(doc.docId);
    expect(restored.metadata.title).toBe(doc.metadata.title);
    expect(restored.getAllVariants().length).toBe(1);
  });
});
