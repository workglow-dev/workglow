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
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";

export const ChunkingStrategy = {
  FIXED: "fixed",
  SENTENCE: "sentence",
  PARAGRAPH: "paragraph",
  SEMANTIC: "semantic",
} as const;

export type ChunkingStrategy = (typeof ChunkingStrategy)[keyof typeof ChunkingStrategy];

const inputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text to chunk",
    },
    chunkSize: {
      type: "number",
      title: "Chunk Size",
      description: "Maximum size of each chunk in characters",
      minimum: 1,
      default: 512,
    },
    chunkOverlap: {
      type: "number",
      title: "Chunk Overlap",
      description: "Number of characters to overlap between chunks",
      minimum: 0,
      default: 50,
    },
    strategy: {
      type: "string",
      enum: Object.values(ChunkingStrategy),
      title: "Chunking Strategy",
      description: "Strategy to use for chunking text",
      default: ChunkingStrategy.FIXED,
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    chunks: {
      type: "array",
      items: { type: "string" },
      title: "Text Chunks",
      description: "The chunked text segments",
    },
    metadata: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "number" },
          startChar: { type: "number" },
          endChar: { type: "number" },
          length: { type: "number" },
        },
        additionalProperties: false,
      },
      title: "Chunk Metadata",
      description: "Metadata for each chunk",
    },
  },
  required: ["chunks", "metadata"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextChunkerTaskInput = FromSchema<typeof inputSchema>;
export type TextChunkerTaskOutput = FromSchema<typeof outputSchema>;

interface ChunkMetadata {
  index: number;
  startChar: number;
  endChar: number;
  length: number;
}

/**
 * Task for chunking text into smaller segments with configurable strategies.
 * Supports fixed-size, sentence-based, paragraph-based, and semantic chunking.
 */
export class TextChunkerTask extends Task<
  TextChunkerTaskInput,
  TextChunkerTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "TextChunkerTask";
  public static category = "Document";
  public static title = "Text Chunker";
  public static description =
    "Splits text into chunks using various strategies (fixed, sentence, paragraph)";
  public static cacheable = true;

  public static inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  async execute(
    input: TextChunkerTaskInput,
    context: IExecuteContext
  ): Promise<TextChunkerTaskOutput> {
    const { text, chunkSize = 512, chunkOverlap = 50, strategy = ChunkingStrategy.FIXED } = input;

    let chunks: string[];
    let metadata: ChunkMetadata[];

    switch (strategy) {
      case ChunkingStrategy.SENTENCE:
        ({ chunks, metadata } = this.chunkBySentence(text, chunkSize, chunkOverlap));
        break;
      case ChunkingStrategy.PARAGRAPH:
        ({ chunks, metadata } = this.chunkByParagraph(text, chunkSize, chunkOverlap));
        break;
      case ChunkingStrategy.SEMANTIC:
        // For now, semantic is the same as sentence-based
        // TODO: Implement true semantic chunking with embeddings
        ({ chunks, metadata } = this.chunkBySentence(text, chunkSize, chunkOverlap));
        break;
      case ChunkingStrategy.FIXED:
      default:
        ({ chunks, metadata } = this.chunkFixed(text, chunkSize, chunkOverlap));
        break;
    }

    return { chunks, metadata };
  }

  /**
   * Fixed-size chunking with overlap
   */
  private chunkFixed(
    text: string,
    chunkSize: number,
    chunkOverlap: number
  ): { chunks: string[]; metadata: ChunkMetadata[] } {
    const chunks: string[] = [];
    const metadata: ChunkMetadata[] = [];
    let startChar = 0;
    let index = 0;

    while (startChar < text.length) {
      const endChar = Math.min(startChar + chunkSize, text.length);
      const chunk = text.substring(startChar, endChar);
      chunks.push(chunk);
      metadata.push({
        index,
        startChar,
        endChar,
        length: chunk.length,
      });

      // Move forward by chunkSize - chunkOverlap, but at least 1 character to prevent infinite loop
      const step = Math.max(1, chunkSize - chunkOverlap);
      startChar += step;
      index++;
    }

    return { chunks, metadata };
  }

  /**
   * Sentence-based chunking that respects sentence boundaries
   */
  private chunkBySentence(
    text: string,
    chunkSize: number,
    chunkOverlap: number
  ): { chunks: string[]; metadata: ChunkMetadata[] } {
    // Split by sentence boundaries (., !, ?, followed by space or newline)
    const sentenceRegex = /[.!?]+[\s\n]+/g;
    const sentences: string[] = [];
    const sentenceStarts: number[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = sentenceRegex.exec(text)) !== null) {
      const sentence = text.substring(lastIndex, match.index + match[0].length);
      sentences.push(sentence);
      sentenceStarts.push(lastIndex);
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text as last sentence
    if (lastIndex < text.length) {
      sentences.push(text.substring(lastIndex));
      sentenceStarts.push(lastIndex);
    }

    // Group sentences into chunks
    const chunks: string[] = [];
    const metadata: ChunkMetadata[] = [];
    let currentChunk = "";
    let currentStartChar = 0;
    let index = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const sentenceStart = sentenceStarts[i];

      // If adding this sentence would exceed chunkSize, save current chunk
      if (currentChunk.length > 0 && currentChunk.length + sentence.length > chunkSize) {
        chunks.push(currentChunk.trim());
        metadata.push({
          index,
          startChar: currentStartChar,
          endChar: currentStartChar + currentChunk.length,
          length: currentChunk.trim().length,
        });
        index++;

        // Start new chunk with overlap
        if (chunkOverlap > 0) {
          // Find sentences to include in overlap
          let overlapText = "";
          let j = i - 1;
          while (j >= 0 && overlapText.length < chunkOverlap) {
            overlapText = sentences[j] + overlapText;
            j--;
          }
          currentChunk = overlapText + sentence;
          currentStartChar = sentenceStarts[Math.max(0, j + 1)];
        } else {
          currentChunk = sentence;
          currentStartChar = sentenceStart;
        }
      } else {
        if (currentChunk.length === 0) {
          currentStartChar = sentenceStart;
        }
        currentChunk += sentence;
      }
    }

    // Add final chunk
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      metadata.push({
        index,
        startChar: currentStartChar,
        endChar: currentStartChar + currentChunk.length,
        length: currentChunk.trim().length,
      });
    }

    return { chunks, metadata };
  }

  /**
   * Paragraph-based chunking that respects paragraph boundaries
   */
  private chunkByParagraph(
    text: string,
    chunkSize: number,
    chunkOverlap: number
  ): { chunks: string[]; metadata: ChunkMetadata[] } {
    // Split by paragraph boundaries (double newline or more)
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    const chunks: string[] = [];
    const metadata: ChunkMetadata[] = [];
    let currentChunk = "";
    let currentStartChar = 0;
    let index = 0;
    let charPosition = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i].trim();
      const paragraphStart = text.indexOf(paragraph, charPosition);
      charPosition = paragraphStart + paragraph.length;

      // If adding this paragraph would exceed chunkSize, save current chunk
      if (currentChunk.length > 0 && currentChunk.length + paragraph.length + 2 > chunkSize) {
        chunks.push(currentChunk.trim());
        metadata.push({
          index,
          startChar: currentStartChar,
          endChar: currentStartChar + currentChunk.length,
          length: currentChunk.trim().length,
        });
        index++;

        // Start new chunk with overlap
        if (chunkOverlap > 0 && i > 0) {
          // Include previous paragraph(s) for overlap
          let overlapText = "";
          let j = i - 1;
          while (j >= 0 && overlapText.length < chunkOverlap) {
            overlapText = paragraphs[j].trim() + "\n\n" + overlapText;
            j--;
          }
          currentChunk = overlapText + paragraph;
          currentStartChar = paragraphStart - overlapText.length;
        } else {
          currentChunk = paragraph;
          currentStartChar = paragraphStart;
        }
      } else {
        if (currentChunk.length === 0) {
          currentStartChar = paragraphStart;
          currentChunk = paragraph;
        } else {
          currentChunk += "\n\n" + paragraph;
        }
      }
    }

    // Add final chunk
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      metadata.push({
        index,
        startChar: currentStartChar,
        endChar: currentStartChar + currentChunk.length,
        length: currentChunk.trim().length,
      });
    }

    return { chunks, metadata };
  }
}

TaskRegistry.registerTask(TextChunkerTask);

export const textChunker = (input: TextChunkerTaskInput, config?: JobQueueTaskConfig) => {
  return new TextChunkerTask({} as TextChunkerTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textChunker: CreateWorkflow<TextChunkerTaskInput, TextChunkerTaskOutput, JobQueueTaskConfig>;
  }
}

Workflow.prototype.textChunker = CreateWorkflow(TextChunkerTask);
