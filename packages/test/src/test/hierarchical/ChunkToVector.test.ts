/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ChunkNode,
  ChunkToVectorTaskOutput,
  HierarchicalChunkerTaskOutput,
  NodeIdGenerator,
  StructuralParser,
} from "@workglow/ai";
import { Workflow } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

describe("ChunkToVectorTask", () => {
  it("should transform chunks and vectors to vector store format", async () => {
    const markdown = "# Test\n\nContent.";
    const docId = await NodeIdGenerator.generateDocId("test", markdown);
    const root = await StructuralParser.parseMarkdown(docId, markdown, "Test");

    // Generate chunks using workflow
    const chunkResult = (await new Workflow()
      .hierarchicalChunker({
        docId,
        documentTree: root,
        maxTokens: 512,
        overlap: 50,
        strategy: "hierarchical",
      })
      .run()) as HierarchicalChunkerTaskOutput;

    // Mock vectors (would normally come from TextEmbeddingTask)
    const mockVectors = chunkResult.chunks.map(() => 
      new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5])
    );

    // Transform to vector store format using workflow
    const result = (await new Workflow()
      .chunkToVector({
        chunks: chunkResult.chunks as ChunkNode[],
        vectors: mockVectors,
      })
      .run()) as ChunkToVectorTaskOutput;

    // Verify output format
    expect(result.ids).toBeDefined();
    expect(result.vectors).toBeDefined();
    expect(result.metadata).toBeDefined();
    expect(result.texts).toBeDefined();

    expect(result.ids.length).toBe(chunkResult.count);
    expect(result.vectors.length).toBe(chunkResult.count);
    expect(result.metadata.length).toBe(chunkResult.count);
    expect(result.texts.length).toBe(chunkResult.count);

    // Check metadata structure
    for (let i = 0; i < result.metadata.length; i++) {
      const meta = result.metadata[i];
      expect(meta.docId).toBe(docId);
      expect(meta.configId).toBeDefined();
      expect(meta.chunkId).toBeDefined();
      expect(meta.leafNodeId).toBeDefined();
      expect(meta.depth).toBeDefined();
      expect(meta.text).toBeDefined();
      expect(meta.nodePath).toBeDefined();
    }

    // Verify IDs match chunks
    for (let i = 0; i < result.ids.length; i++) {
      expect(result.ids[i]).toBe(chunkResult.chunks[i].chunkId);
    }
  });

  it("should throw error on length mismatch", async () => {
    const chunks = [
      {
        chunkId: "chunk_1",
        docId: "doc_1",
        configId: "cfg_1",
        text: "Test",
        nodePath: ["node_1"],
        depth: 1,
      },
      {
        chunkId: "chunk_2",
        docId: "doc_1",
        configId: "cfg_1",
        text: "Test 2",
        nodePath: ["node_1"],
        depth: 1,
      },
    ];

    const vectors = [new Float32Array([1, 2, 3])]; // Only 1 vector for 2 chunks

    // Using workflow
    await expect(
      new Workflow()
        .chunkToVector({ chunks, vectors })
        .run()
    ).rejects.toThrow("Mismatch");
  });

  it("should include enrichment in metadata if present", async () => {
    const chunks = [
      {
        chunkId: "chunk_1",
        docId: "doc_1",
        configId: "cfg_1",
        text: "Test",
        nodePath: ["node_1"],
        depth: 1,
        enrichment: {
          summary: "Test summary",
          entities: [{ text: "Entity", type: "TEST", score: 0.9 }],
        },
      },
    ];

    const vectors = [new Float32Array([1, 2, 3])];

    const result = (await new Workflow()
      .chunkToVector({ chunks, vectors })
      .run()) as ChunkToVectorTaskOutput;

    const metadata = result.metadata as Array<{
      summary?: string;
      entities?: Array<{ text: string; type: string; score: number }>;
      [key: string]: unknown;
    }>;
    expect(metadata[0].summary).toBe("Test summary");
    expect(metadata[0].entities).toBeDefined();
    expect(metadata[0].entities!.length).toBe(1);
  });
});
