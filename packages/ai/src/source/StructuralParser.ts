/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { NodeIdGenerator } from "./DocumentNode";
import {
  type DocumentRootNode,
  NodeKind,
  type ParagraphNode,
  type SectionNode,
} from "./DocumentSchema";

/**
 * Parse markdown into a hierarchical DocumentNode tree
 */
export class StructuralParser {
  /**
   * Parse markdown text into a hierarchical document tree
   */
  static async parseMarkdown(
    docId: string,
    text: string,
    title: string
  ): Promise<DocumentRootNode> {
    const lines = text.split("\n");
    let currentOffset = 0;

    const root: DocumentRootNode = {
      nodeId: await NodeIdGenerator.generateStructuralNodeId(docId, NodeKind.DOCUMENT, {
        startOffset: 0,
        endOffset: text.length,
      }),
      kind: NodeKind.DOCUMENT,
      range: { startOffset: 0, endOffset: text.length },
      text: title,
      children: [],
    };

    let currentParentStack: Array<DocumentRootNode | SectionNode> = [root];
    let textBuffer: string[] = [];
    let textBufferStartOffset = 0;

    const flushTextBuffer = async () => {
      if (textBuffer.length > 0) {
        const content = textBuffer.join("\n").trim();
        if (content) {
          const paragraphStartOffset = textBufferStartOffset;
          const paragraphEndOffset = currentOffset;

          const paragraph: ParagraphNode = {
            nodeId: await NodeIdGenerator.generateChildNodeId(
              currentParentStack[currentParentStack.length - 1].nodeId,
              currentParentStack[currentParentStack.length - 1].children.length
            ),
            kind: NodeKind.PARAGRAPH,
            range: {
              startOffset: paragraphStartOffset,
              endOffset: paragraphEndOffset,
            },
            text: content,
          };

          currentParentStack[currentParentStack.length - 1].children.push(paragraph);
        }
        textBuffer = [];
      }
    };

    for (const line of lines) {
      const lineLength = line.length + 1; // +1 for newline

      // Check if line is a header
      const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headerMatch) {
        await flushTextBuffer();

        const level = headerMatch[1].length;
        const headerTitle = headerMatch[2];

        // Pop stack until we find appropriate parent
        while (
          currentParentStack.length > 1 &&
          currentParentStack[currentParentStack.length - 1].kind === NodeKind.SECTION &&
          (currentParentStack[currentParentStack.length - 1] as SectionNode).level >= level
        ) {
          const poppedSection = currentParentStack.pop() as SectionNode;
          // Update endOffset of popped section
          const updatedSection: SectionNode = {
            ...poppedSection,
            range: {
              ...poppedSection.range,
              endOffset: currentOffset,
            },
          };
          // Replace in parent's children
          const parent = currentParentStack[currentParentStack.length - 1];
          parent.children[parent.children.length - 1] = updatedSection;
        }

        const sectionStartOffset = currentOffset;
        const section: SectionNode = {
          nodeId: await NodeIdGenerator.generateStructuralNodeId(docId, NodeKind.SECTION, {
            startOffset: sectionStartOffset,
            endOffset: text.length, // Will be updated when section closes
          }),
          kind: NodeKind.SECTION,
          level,
          title: headerTitle,
          range: {
            startOffset: sectionStartOffset,
            endOffset: text.length,
          },
          text: headerTitle,
          children: [],
        };

        currentParentStack[currentParentStack.length - 1].children.push(section);
        currentParentStack.push(section);
      } else {
        // Accumulate text
        if (textBuffer.length === 0) {
          textBufferStartOffset = currentOffset;
        }
        textBuffer.push(line);
      }

      currentOffset += lineLength;
    }

    await flushTextBuffer();

    // Close any remaining sections
    while (currentParentStack.length > 1) {
      const section = currentParentStack.pop() as SectionNode;
      const updatedSection: SectionNode = {
        ...section,
        range: {
          ...section.range,
          endOffset: text.length,
        },
      };
      const parent = currentParentStack[currentParentStack.length - 1];
      parent.children[parent.children.length - 1] = updatedSection;
    }

    return root;
  }

  /**
   * Parse plain text into a hierarchical document tree
   * Splits by double newlines to create paragraphs
   */
  static async parsePlainText(
    docId: string,
    text: string,
    title: string
  ): Promise<DocumentRootNode> {
    const root: DocumentRootNode = {
      nodeId: await NodeIdGenerator.generateStructuralNodeId(docId, NodeKind.DOCUMENT, {
        startOffset: 0,
        endOffset: text.length,
      }),
      kind: NodeKind.DOCUMENT,
      range: { startOffset: 0, endOffset: text.length },
      text: title,
      children: [],
    };

    // Split by double newlines to get paragraphs while tracking offsets
    const paragraphRegex = /\n\s*\n/g;
    let lastIndex = 0;
    let paragraphIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = paragraphRegex.exec(text)) !== null) {
      const rawParagraph = text.slice(lastIndex, match.index);
      const paragraphText = rawParagraph.trim();

      if (paragraphText.length > 0) {
        const trimmedRelativeStart = rawParagraph.indexOf(paragraphText);
        const startOffset = lastIndex + trimmedRelativeStart;
        const endOffset = startOffset + paragraphText.length;

        const paragraph: ParagraphNode = {
          nodeId: await NodeIdGenerator.generateChildNodeId(root.nodeId, paragraphIndex),
          kind: NodeKind.PARAGRAPH,
          range: {
            startOffset,
            endOffset,
          },
          text: paragraphText,
        };

        root.children.push(paragraph);
        paragraphIndex++;
      }

      lastIndex = paragraphRegex.lastIndex;
    }

    // Handle trailing paragraph after the last double newline, if any
    if (lastIndex < text.length) {
      const rawParagraph = text.slice(lastIndex);
      const paragraphText = rawParagraph.trim();

      if (paragraphText.length > 0) {
        const trimmedRelativeStart = rawParagraph.indexOf(paragraphText);
        const startOffset = lastIndex + trimmedRelativeStart;
        const endOffset = startOffset + paragraphText.length;

        const paragraph: ParagraphNode = {
          nodeId: await NodeIdGenerator.generateChildNodeId(root.nodeId, paragraphIndex),
          kind: NodeKind.PARAGRAPH,
          range: {
            startOffset,
            endOffset,
          },
          text: paragraphText,
        };

        root.children.push(paragraph);
      }
    }
    return root;
  }

  /**
   * Auto-detect format and parse
   */
  static parse(
    docId: string,
    text: string,
    title: string,
    format?: "markdown" | "text"
  ): Promise<DocumentRootNode> {
    if (format === "markdown" || (!format && this.looksLikeMarkdown(text))) {
      return this.parseMarkdown(docId, text, title);
    }
    return this.parsePlainText(docId, text, title);
  }

  /**
   * Check if text contains markdown header patterns
   * Looks for lines starting with 1-6 hash symbols followed by whitespace
   */
  private static looksLikeMarkdown(text: string): boolean {
    // Check for markdown header patterns: line starting with # followed by space
    return /^#{1,6}\s/m.test(text);
  }
}
