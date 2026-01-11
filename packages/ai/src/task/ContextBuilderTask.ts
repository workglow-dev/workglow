/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  JobQueueTaskConfig,
  Task,
  TaskRegistry,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";

export const ContextFormat = {
  SIMPLE: "simple",
  NUMBERED: "numbered",
  XML: "xml",
  MARKDOWN: "markdown",
  JSON: "json",
} as const;

export type ContextFormat = (typeof ContextFormat)[keyof typeof ContextFormat];

const inputSchema = {
  type: "object",
  properties: {
    chunks: {
      type: "array",
      items: { type: "string" },
      title: "Text Chunks",
      description: "Retrieved text chunks to format",
    },
    metadata: {
      type: "array",
      items: {
        type: "object",
        title: "Metadata",
        description: "Metadata for each chunk",
      },
      title: "Metadata",
      description: "Metadata for each chunk (optional)",
    },
    scores: {
      type: "array",
      items: { type: "number" },
      title: "Scores",
      description: "Relevance scores for each chunk (optional)",
    },
    format: {
      type: "string",
      enum: Object.values(ContextFormat),
      title: "Format",
      description: "Format for the context output",
      default: ContextFormat.SIMPLE,
    },
    maxLength: {
      type: "number",
      title: "Max Length",
      description: "Maximum length of context in characters (0 = unlimited)",
      minimum: 0,
      default: 0,
    },
    includeMetadata: {
      type: "boolean",
      title: "Include Metadata",
      description: "Whether to include metadata in the context",
      default: false,
    },
    separator: {
      type: "string",
      title: "Separator",
      description: "Separator between chunks",
      default: "\n\n",
    },
  },
  required: ["chunks"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    context: {
      type: "string",
      title: "Context",
      description: "Formatted context string for LLM",
    },
    chunksUsed: {
      type: "number",
      title: "Chunks Used",
      description: "Number of chunks included in context",
    },
    totalLength: {
      type: "number",
      title: "Total Length",
      description: "Total length of context in characters",
    },
  },
  required: ["context", "chunksUsed", "totalLength"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ContextBuilderTaskInput = FromSchema<typeof inputSchema>;
export type ContextBuilderTaskOutput = FromSchema<typeof outputSchema>;

/**
 * Task for formatting retrieved chunks into context for LLM prompts.
 * Supports various formatting styles and length constraints.
 */
export class ContextBuilderTask extends Task<
  ContextBuilderTaskInput,
  ContextBuilderTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "ContextBuilderTask";
  public static category = "RAG";
  public static title = "Context Builder";
  public static description = "Format retrieved chunks into context for LLM prompts";
  public static cacheable = true;

  public static inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  async executeReactive(
    input: ContextBuilderTaskInput,
    output: ContextBuilderTaskOutput
  ): Promise<ContextBuilderTaskOutput> {
    const {
      chunks,
      metadata = [],
      scores = [],
      format = ContextFormat.SIMPLE,
      maxLength = 0,
      includeMetadata = false,
      separator = "\n\n",
    } = input;

    let context = "";
    let chunksUsed = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const meta = metadata[i];
      const score = scores[i];

      let formattedChunk = this.formatChunk(chunk, meta, score, i, format, includeMetadata);

      // Check length constraint
      if (maxLength > 0) {
        const potentialLength = context.length + formattedChunk.length + separator.length;
        if (potentialLength > maxLength) {
          // Try to fit partial chunk if it's the first one
          if (chunksUsed === 0) {
            const available = maxLength - context.length;
            if (available > 100) {
              // Only include partial if we have reasonable space
              formattedChunk = formattedChunk.substring(0, available - 3) + "...";
              context += formattedChunk;
              chunksUsed++;
            }
          }
          break;
        }
      }

      if (chunksUsed > 0) {
        context += separator;
      }
      context += formattedChunk;
      chunksUsed++;
    }

    return {
      context,
      chunksUsed,
      totalLength: context.length,
    };
  }

  private formatChunk(
    chunk: string,
    metadata: any,
    score: number | undefined,
    index: number,
    format: ContextFormat,
    includeMetadata: boolean
  ): string {
    switch (format) {
      case ContextFormat.NUMBERED:
        return this.formatNumbered(chunk, metadata, score, index, includeMetadata);
      case ContextFormat.XML:
        return this.formatXML(chunk, metadata, score, index, includeMetadata);
      case ContextFormat.MARKDOWN:
        return this.formatMarkdown(chunk, metadata, score, index, includeMetadata);
      case ContextFormat.JSON:
        return this.formatJSON(chunk, metadata, score, index, includeMetadata);
      case ContextFormat.SIMPLE:
      default:
        return chunk;
    }
  }

  private formatNumbered(
    chunk: string,
    metadata: any,
    score: number | undefined,
    index: number,
    includeMetadata: boolean
  ): string {
    let result = `[${index + 1}] ${chunk}`;
    if (includeMetadata && metadata) {
      const metaStr = this.formatMetadataInline(metadata, score);
      if (metaStr) {
        result += ` ${metaStr}`;
      }
    }
    return result;
  }

  private formatXML(
    chunk: string,
    metadata: any,
    score: number | undefined,
    index: number,
    includeMetadata: boolean
  ): string {
    let result = `<chunk id="${index + 1}">`;
    if (includeMetadata && (metadata || score !== undefined)) {
      result += "\n  <metadata>";
      if (score !== undefined) {
        result += `\n    <score>${score.toFixed(4)}</score>`;
      }
      if (metadata) {
        for (const [key, value] of Object.entries(metadata)) {
          result += `\n    <${key}>${this.escapeXML(String(value))}</${key}>`;
        }
      }
      result += "\n  </metadata>";
      result += `\n  <content>${this.escapeXML(chunk)}</content>`;
      result += "\n</chunk>";
    } else {
      result += `${this.escapeXML(chunk)}</chunk>`;
    }
    return result;
  }

  private formatMarkdown(
    chunk: string,
    metadata: any,
    score: number | undefined,
    index: number,
    includeMetadata: boolean
  ): string {
    let result = `### Chunk ${index + 1}\n\n`;
    if (includeMetadata && (metadata || score !== undefined)) {
      result += "**Metadata:**\n";
      if (score !== undefined) {
        result += `- Score: ${score.toFixed(4)}\n`;
      }
      if (metadata) {
        for (const [key, value] of Object.entries(metadata)) {
          result += `- ${key}: ${value}\n`;
        }
      }
      result += "\n";
    }
    result += chunk;
    return result;
  }

  private formatJSON(
    chunk: string,
    metadata: any,
    score: number | undefined,
    index: number,
    includeMetadata: boolean
  ): string {
    const obj: any = {
      index: index + 1,
      content: chunk,
    };
    if (includeMetadata) {
      if (score !== undefined) {
        obj.score = score;
      }
      if (metadata) {
        obj.metadata = metadata;
      }
    }
    return JSON.stringify(obj);
  }

  private formatMetadataInline(metadata: any, score: number | undefined): string {
    const parts: string[] = [];
    if (score !== undefined) {
      parts.push(`score=${score.toFixed(4)}`);
    }
    if (metadata) {
      for (const [key, value] of Object.entries(metadata)) {
        parts.push(`${key}=${value}`);
      }
    }
    return parts.length > 0 ? `(${parts.join(", ")})` : "";
  }

  private escapeXML(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}


export const contextBuilder = (input: ContextBuilderTaskInput, config?: JobQueueTaskConfig) => {
  return new ContextBuilderTask({} as ContextBuilderTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    contextBuilder: CreateWorkflow<
      ContextBuilderTaskInput,
      ContextBuilderTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.contextBuilder = CreateWorkflow(ContextBuilderTask);
