/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecuteContext,
  JobQueueTaskConfig,
  Task,
  TaskRegistry,
  Workflow,
  type ProvenanceItem,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";

import { estimateTokens, getChildren, hasChildren, NodeIdGenerator } from "../source/DocumentNode";
import {
  ChunkNodeSchema,
  type ChunkNode,
  type DocumentNode,
  type TokenBudget,
} from "../source/DocumentSchema";
import { deriveConfigId } from "../source/ProvenanceUtils";

const inputSchema = {
  type: "object",
  properties: {
    docId: {
      type: "string",
      title: "Document ID",
      description: "The ID of the document",
    },
    documentTree: {
      title: "Document Tree",
      description: "The hierarchical document tree to chunk",
    },
    maxTokens: {
      type: "number",
      title: "Max Tokens",
      description: "Maximum tokens per chunk",
      minimum: 50,
      default: 512,
    },
    overlap: {
      type: "number",
      title: "Overlap",
      description: "Overlap in tokens between chunks",
      minimum: 0,
      default: 50,
    },
    reservedTokens: {
      type: "number",
      title: "Reserved Tokens",
      description: "Reserved tokens for metadata/wrappers",
      minimum: 0,
      default: 10,
    },
    strategy: {
      type: "string",
      enum: ["hierarchical", "flat", "sentence"],
      title: "Chunking Strategy",
      description: "Strategy for chunking",
      default: "hierarchical",
    },
  },
  required: [],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    docId: {
      type: "string",
      title: "Document ID",
      description: "The document ID (passed through)",
    },
    chunks: {
      type: "array",
      items: ChunkNodeSchema(),
      title: "Chunks",
      description: "Array of chunk nodes",
    },
    text: {
      type: "array",
      items: { type: "string" },
      title: "Texts",
      description: "Chunk texts (for TextEmbeddingTask)",
    },
    count: {
      type: "number",
      title: "Count",
      description: "Number of chunks generated",
    },
  },
  required: ["docId", "chunks", "text", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type HierarchicalChunkerTaskInput = FromSchema<typeof inputSchema>;
export type HierarchicalChunkerTaskOutput = FromSchema<typeof outputSchema>;

/**
 * Task for hierarchical chunking that respects token budgets and document structure
 */
export class HierarchicalChunkerTask extends Task<
  HierarchicalChunkerTaskInput,
  HierarchicalChunkerTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "HierarchicalChunkerTask";
  public static category = "Document";
  public static title = "Hierarchical Chunker";
  public static description = "Chunk documents hierarchically respecting token budgets";
  public static cacheable = true;

  public static inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  public getProvenance(): ProvenanceItem | undefined {
    return {
      chunkerStrategy: this.runInputData.strategy || "hierarchical",
      maxTokens: this.runInputData.maxTokens || 512,
      overlap: this.runInputData.overlap || 50,
      docId: this.runInputData.docId,
    };
  }

  async execute(
    input: HierarchicalChunkerTaskInput,
    context: IExecuteContext
  ): Promise<HierarchicalChunkerTaskOutput> {
    const {
      docId,
      documentTree,
      maxTokens = 512,
      overlap = 50,
      reservedTokens = 10,
      strategy = "hierarchical",
    } = input;

    if (!docId) {
      throw new Error("docId is required");
    }
    if (!documentTree) {
      throw new Error("documentTree is required");
    }

    const root = documentTree as DocumentNode;
    const tokenBudget: TokenBudget = {
      maxTokensPerChunk: maxTokens,
      overlapTokens: overlap,
      reservedTokens,
    };

    // Derive configId from current provenance
    const provenance = this.getProvenance();
    const configId = await deriveConfigId(provenance ? [provenance] : []);

    const chunks: ChunkNode[] = [];

    if (strategy === "hierarchical") {
      await this.chunkHierarchically(root, [], docId, configId, tokenBudget, chunks);
    } else {
      // Flat chunking: treat entire document as flat text
      await this.chunkFlat(root, docId, configId, tokenBudget, chunks);
    }

    return {
      docId,
      chunks,
      text: chunks.map((c) => c.text),
      count: chunks.length,
    };
  }

  /**
   * Hierarchical chunking that respects document structure
   */
  private async chunkHierarchically(
    node: DocumentNode,
    nodePath: string[],
    docId: string,
    configId: string,
    tokenBudget: TokenBudget,
    chunks: ChunkNode[]
  ): Promise<void> {
    const currentPath = [...nodePath, node.nodeId];

    // If node has no children, it's a leaf - chunk its text
    if (!hasChildren(node)) {
      await this.chunkText(
        node.text,
        currentPath,
        docId,
        configId,
        tokenBudget,
        chunks,
        node.nodeId
      );
      return;
    }

    // For nodes with children, recursively chunk children
    const children = getChildren(node);
    for (const child of children) {
      await this.chunkHierarchically(child, currentPath, docId, configId, tokenBudget, chunks);
    }
  }

  /**
   * Chunk a single text string
   */
  private async chunkText(
    text: string,
    nodePath: string[],
    docId: string,
    configId: string,
    tokenBudget: TokenBudget,
    chunks: ChunkNode[],
    leafNodeId: string
  ): Promise<void> {
    const maxChars = (tokenBudget.maxTokensPerChunk - tokenBudget.reservedTokens) * 4;
    const overlapChars = tokenBudget.overlapTokens * 4;

    if (estimateTokens(text) <= tokenBudget.maxTokensPerChunk - tokenBudget.reservedTokens) {
      // Text fits in one chunk
      const chunkId = await NodeIdGenerator.generateChunkId(docId, configId, leafNodeId, 0);
      chunks.push({
        chunkId,
        docId,
        configId,
        text,
        nodePath,
        depth: nodePath.length,
      });
      return;
    }

    // Split into multiple chunks with overlap
    let chunkOrdinal = 0;
    let startOffset = 0;

    while (startOffset < text.length) {
      const endOffset = Math.min(startOffset + maxChars, text.length);
      const chunkText = text.substring(startOffset, endOffset);

      const chunkId = await NodeIdGenerator.generateChunkId(
        docId,
        configId,
        leafNodeId,
        chunkOrdinal
      );

      chunks.push({
        chunkId,
        docId,
        configId,
        text: chunkText,
        nodePath,
        depth: nodePath.length,
      });

      chunkOrdinal++;
      startOffset += maxChars - overlapChars;

      // Prevent infinite loop
      if (overlapChars >= maxChars) {
        startOffset = endOffset;
      }
    }
  }

  /**
   * Flat chunking (ignores hierarchy)
   */
  private async chunkFlat(
    root: DocumentNode,
    docId: string,
    configId: string,
    tokenBudget: TokenBudget,
    chunks: ChunkNode[]
  ): Promise<void> {
    // Collect all text from the tree
    const allText = this.collectAllText(root);
    await this.chunkText(allText, [root.nodeId], docId, configId, tokenBudget, chunks, root.nodeId);
  }

  /**
   * Collect all text from a node and its descendants
   */
  private collectAllText(node: DocumentNode): string {
    const texts: string[] = [];

    const traverse = (n: DocumentNode) => {
      if (!hasChildren(n)) {
        texts.push(n.text);
      } else {
        for (const child of getChildren(n)) {
          traverse(child);
        }
      }
    };

    traverse(node);
    return texts.join("\n\n");
  }
}

TaskRegistry.registerTask(HierarchicalChunkerTask);

export const hierarchicalChunker = (
  input: HierarchicalChunkerTaskInput,
  config?: JobQueueTaskConfig
) => {
  return new HierarchicalChunkerTask({} as HierarchicalChunkerTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    hierarchicalChunker: CreateWorkflow<
      HierarchicalChunkerTaskInput,
      HierarchicalChunkerTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.hierarchicalChunker = CreateWorkflow(HierarchicalChunkerTask);
