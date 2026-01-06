/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { NodeIdGenerator, NodeKind, StructuralParser } from "@workglow/ai";
import { describe, expect, it } from "vitest";

describe("StructuralParser", () => {
  describe("Markdown parsing", () => {
    it("should parse markdown with headers into hierarchical tree", async () => {
      const markdown = `# Main Title

This is the intro.

## Section 1

Content for section 1.

## Section 2

Content for section 2.

### Subsection 2.1

Nested content.`;

      const docId = "doc_test123";
      const root = await StructuralParser.parseMarkdown(docId, markdown, "Test Document");

      expect(root.kind).toBe(NodeKind.DOCUMENT);
      expect(root.children.length).toBeGreaterThan(0);

      // Find sections - parser should create sections for headers
      const sections = root.children.filter((child) => child.kind === NodeKind.SECTION);
      expect(sections.length).toBeGreaterThan(0);

      // Should have some children (sections or paragraphs)
      expect(root.children.length).toBeGreaterThanOrEqual(1);
    });

    it("should preserve source offsets", async () => {
      const markdown = `# Title

Paragraph one.

Paragraph two.`;

      const docId = "doc_test456";
      const root = await StructuralParser.parseMarkdown(docId, markdown, "Test");

      expect(root.range.startOffset).toBe(0);
      expect(root.range.endOffset).toBe(markdown.length);

      // Check children have valid offsets
      for (const child of root.children) {
        expect(child.range.startOffset).toBeGreaterThanOrEqual(0);
        expect(child.range.endOffset).toBeLessThanOrEqual(markdown.length);
        expect(child.range.endOffset).toBeGreaterThan(child.range.startOffset);
      }
    });

    it("should handle nested sections correctly", async () => {
      const markdown = `# Level 1

Content.

## Level 2

More content.

### Level 3

Deep content.`;

      const docId = "doc_test789";
      const root = await StructuralParser.parseMarkdown(docId, markdown, "Nested Test");

      // Find first section (Level 1)
      const level1 = root.children.find(
        (c) => c.kind === NodeKind.SECTION && (c as any).level === 1
      );
      expect(level1).toBeDefined();

      // It should have children including level 2
      const level2 = (level1 as any).children.find(
        (c: any) => c.kind === NodeKind.SECTION && c.level === 2
      );
      expect(level2).toBeDefined();

      // Level 2 should have level 3
      const level3 = (level2 as any).children.find(
        (c: any) => c.kind === NodeKind.SECTION && c.level === 3
      );
      expect(level3).toBeDefined();
    });
  });

  describe("Plain text parsing", () => {
    it("should parse plain text into paragraphs", async () => {
      const text = `First paragraph here.

Second paragraph here.

Third paragraph here.`;

      const docId = "doc_plain123";
      const root = await StructuralParser.parsePlainText(docId, text, "Plain Text");

      expect(root.kind).toBe(NodeKind.DOCUMENT);
      expect(root.children.length).toBe(3);

      for (const child of root.children) {
        expect(child.kind).toBe(NodeKind.PARAGRAPH);
      }
    });

    it("should handle single paragraph", async () => {
      const text = "Just one paragraph.";

      const docId = "doc_plain456";
      const root = await StructuralParser.parsePlainText(docId, text, "Single");

      expect(root.children.length).toBe(1);
      expect(root.children[0].kind).toBe(NodeKind.PARAGRAPH);
      expect(root.children[0].text).toBe(text);
    });
  });

  describe("Auto-detect", () => {
    it("should auto-detect markdown", async () => {
      const markdown = "# Header\n\nParagraph.";
      const docId = "doc_auto123";

      const root = await StructuralParser.parse(docId, markdown, "Auto");

      // Should have detected markdown and created sections
      const hasSection = root.children.some((c) => c.kind === NodeKind.SECTION);
      expect(hasSection).toBe(true);
    });

    it("should default to plain text when no markdown markers", async () => {
      const text = "Just plain text here.";
      const docId = "doc_auto456";

      const root = await StructuralParser.parse(docId, text, "Plain");

      // Should be plain paragraph
      expect(root.children[0].kind).toBe(NodeKind.PARAGRAPH);
    });
  });

  describe("NodeIdGenerator", () => {
    it("should generate consistent docIds", async () => {
      const id1 = await NodeIdGenerator.generateDocId("source1", "content");
      const id2 = await NodeIdGenerator.generateDocId("source1", "content");

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^doc_[0-9a-f]{16}$/);
    });

    it("should generate different IDs for different content", () => {
      const id1 = NodeIdGenerator.generateDocId("source", "content1");
      const id2 = NodeIdGenerator.generateDocId("source", "content2");

      expect(id1).not.toBe(id2);
    });

    it("should generate consistent structural node IDs", async () => {
      const docId = "doc_test";
      const range = { startOffset: 0, endOffset: 100 };

      const id1 = await NodeIdGenerator.generateStructuralNodeId(docId, NodeKind.SECTION, range);
      const id2 = await NodeIdGenerator.generateStructuralNodeId(docId, NodeKind.SECTION, range);

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^node_[0-9a-f]{16}$/);
    });

    it("should generate consistent child node IDs", async () => {
      const parentId = "node_parent";
      const ordinal = 2;

      const id1 = await NodeIdGenerator.generateChildNodeId(parentId, ordinal);
      const id2 = await NodeIdGenerator.generateChildNodeId(parentId, ordinal);

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^node_[0-9a-f]{16}$/);
    });

    it("should generate consistent chunk IDs", async () => {
      const docId = "doc_test";
      const leafNodeId = "node_leaf";
      const ordinal = 0;

      const id1 = await NodeIdGenerator.generateChunkId(docId, leafNodeId, ordinal);
      const id2 = await NodeIdGenerator.generateChunkId(docId, leafNodeId, ordinal);

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^chunk_[0-9a-f]{16}$/);
    });
  });
});
