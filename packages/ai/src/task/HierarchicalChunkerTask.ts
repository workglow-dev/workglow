/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ChunkNodeSchema,
  estimateTokens,
  getChildren,
  hasChildren,
  type ChunkNode,
  type DocumentNode,
  type TokenBudget,
} from "@workglow/dataset";
import {
  CreateWorkflow,
  IExecuteContext,
  JobQueueTaskConfig,
  Task,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema, uuid4 } from "@workglow/util";
import { CountTokensTask } from "./CountTokensTask";
import { TypeModel } from "./base/AiTaskSchemas";

const modelSchema = TypeModel("model", {
  title: "Model",
  description: "Model to use for token counting",
});

const inputSchema = {
  type: "object",
  properties: {
    doc_id: {
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
    model: modelSchema,
  },
  required: ["doc_id", "documentTree"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    doc_id: {
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
  required: ["doc_id", "chunks", "text", "count"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type HierarchicalChunkerTaskInput = FromSchema<typeof inputSchema>;
export type HierarchicalChunkerTaskOutput = FromSchema<typeof outputSchema>;

/**
 * Task for hierarchical chunking that respects token budgets and document structure.
 * Pass a `model` in the input to use {@link CountTokensTask} for accurate token
 * counting; when omitted, the task falls back to the character-based estimate
 * provided by {@link estimateTokens}.
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

  async execute(
    input: HierarchicalChunkerTaskInput,
    context: IExecuteContext
  ): Promise<HierarchicalChunkerTaskOutput> {
    const {
      doc_id,
      documentTree,
      maxTokens = 512,
      overlap = 50,
      reservedTokens = 10,
      strategy = "hierarchical",
    } = input;

    if (!doc_id) {
      throw new Error("doc_id is required");
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

    let countFn: (text: string) => Promise<number> = async (text: string) => estimateTokens(text);
    if (input.model) {
      const countTask = context.own(new CountTokensTask({ model: input.model }));
      countFn = async (text: string): Promise<number> => {
        try {
          const result = await countTask.run({ text });
          return result.count;
        } catch (_err) {
          // Fall back to local token estimation if CountTokensTask is unavailable or fails.
          return estimateTokens(text);
        }
      };
    }

    const chunks: ChunkNode[] = [];

    if (strategy === "hierarchical") {
      await this.chunkHierarchically(root, [], doc_id, tokenBudget, chunks, countFn);
    } else {
      await this.chunkFlat(root, doc_id, tokenBudget, chunks, countFn);
    }
    return {
      doc_id,
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
    doc_id: string,
    tokenBudget: TokenBudget,
    chunks: ChunkNode[],
    countFn: (text: string) => Promise<number>
  ): Promise<void> {
    const currentPath = [...nodePath, node.nodeId];

    if (!hasChildren(node)) {
      await this.chunkText(
        node.text,
        currentPath,
        doc_id,
        tokenBudget,
        chunks,
        node.nodeId,
        countFn
      );
      return;
    }

    const children = getChildren(node);
    for (const child of children) {
      await this.chunkHierarchically(child, currentPath, doc_id, tokenBudget, chunks, countFn);
    }
  }

  /**
   * Chunk a single text string, using countFn for token counting.
   * countFn always returns a number -- it falls back to estimation internally
   * when no real tokenizer is available.
   */
  private async chunkText(
    text: string,
    nodePath: string[],
    doc_id: string,
    tokenBudget: TokenBudget,
    chunks: ChunkNode[],
    leafNodeId: string,
    countFn: (text: string) => Promise<number>
  ): Promise<void> {
    const maxTokens = tokenBudget.maxTokensPerChunk - tokenBudget.reservedTokens;
    const overlapTokens = tokenBudget.overlapTokens;

    if (maxTokens <= 0) {
      throw new Error(
        `Invalid token budget: reservedTokens (${tokenBudget.reservedTokens}) must be less than maxTokensPerChunk (${tokenBudget.maxTokensPerChunk})`
      );
    }
    if (overlapTokens >= maxTokens) {
      throw new Error(
        `Invalid token budget: overlapTokens (${overlapTokens}) must be less than effective maxTokens (${maxTokens})`
      );
    }

    const count = await countFn(text);
    if (count <= maxTokens) {
      chunks.push({
        chunkId: uuid4(),
        doc_id,
        text,
        nodePath,
        depth: nodePath.length,
      });
      return;
    }

    // Binary search for the character boundary that corresponds to targetTokens.
    // countFn handles the estimation fallback, so we always use it.
    // Uses ceil-biased midpoint so that when hi = lo + 1, mid = hi is always checked,
    // preventing the boundary from stalling at startChar on the last character of text.
    const findCharBoundary = async (startChar: number, targetTokens: number): Promise<number> => {
      let lo = startChar;
      let hi = Math.min(startChar + targetTokens * 6, text.length); // generous upper bound
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const count = await countFn(text.substring(startChar, mid));
        if (count <= targetTokens) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }
      return lo;
    };

    let startOffset = 0;

    while (startOffset < text.length) {
      const boundary = await findCharBoundary(startOffset, maxTokens);
      // Ensure endOffset always advances past startOffset to prevent an infinite loop.
      // In the extreme edge case where even one character exceeds maxTokens, we
      // include that character anyway (the chunk may be slightly oversize).
      const endOffset = Math.max(Math.min(boundary, text.length), startOffset + 1);

      chunks.push({
        chunkId: uuid4(),
        doc_id,
        text: text.substring(startOffset, endOffset),
        nodePath,
        depth: nodePath.length,
      });

      if (endOffset >= text.length) break;

      const nextStart = await findCharBoundary(startOffset, maxTokens - overlapTokens);
      // Ensure we always make forward progress to prevent an infinite loop.
      startOffset = nextStart > startOffset ? nextStart : endOffset;
    }
  }

  /**
   * Flat chunking (ignores hierarchy)
   */
  private async chunkFlat(
    root: DocumentNode,
    doc_id: string,
    tokenBudget: TokenBudget,
    chunks: ChunkNode[],
    countFn: (text: string) => Promise<number>
  ): Promise<void> {
    const allText = this.collectAllText(root);
    await this.chunkText(allText, [root.nodeId], doc_id, tokenBudget, chunks, root.nodeId, countFn);
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
