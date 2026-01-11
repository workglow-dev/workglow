/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DocumentNode, NodeIdGenerator, StructuralParser } from "@workglow/storage";
import {
  CreateWorkflow,
  IExecuteContext,
  JobQueueTaskConfig,
  Task,
  TaskRegistry,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";

const inputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text content to parse",
    },
    title: {
      type: "string",
      title: "Title",
      description: "Document title",
    },
    format: {
      type: "string",
      enum: ["markdown", "text", "auto"],
      title: "Format",
      description: "Document format (auto-detects if not specified)",
      default: "auto",
    },
    sourceUri: {
      type: "string",
      title: "Source URI",
      description: "Source identifier for document ID generation",
    },
    doc_id: {
      type: "string",
      title: "Document ID",
      description: "Pre-generated document ID (optional)",
    },
  },
  required: ["text", "title"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    doc_id: {
      type: "string",
      title: "Document ID",
      description: "Generated or provided document ID",
    },
    documentTree: {
      title: "Document Tree",
      description: "Parsed hierarchical document tree",
    },
    nodeCount: {
      type: "number",
      title: "Node Count",
      description: "Total number of nodes in the tree",
    },
  },
  required: ["doc_id", "documentTree", "nodeCount"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type StructuralParserTaskInput = FromSchema<typeof inputSchema>;
export type StructuralParserTaskOutput = FromSchema<typeof outputSchema>;

/**
 * Task for parsing documents into hierarchical tree structure
 * Supports markdown and plain text with automatic format detection
 */
export class StructuralParserTask extends Task<
  StructuralParserTaskInput,
  StructuralParserTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "StructuralParserTask";
  public static category = "Document";
  public static title = "Structural Parser";
  public static description = "Parse documents into hierarchical tree structure";
  public static cacheable = true;

  public static inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  async execute(
    input: StructuralParserTaskInput,
    context: IExecuteContext
  ): Promise<StructuralParserTaskOutput> {
    const { text, title, format = "auto", sourceUri, doc_id: providedDocId } = input;

    // Generate or use provided doc_id
    const doc_id =
      providedDocId || (await NodeIdGenerator.generateDocId(sourceUri || "document", text));

    // Parse based on format
    let documentTree: DocumentNode;
    if (format === "markdown") {
      documentTree = await StructuralParser.parseMarkdown(doc_id, text, title);
    } else if (format === "text") {
      documentTree = await StructuralParser.parsePlainText(doc_id, text, title);
    } else {
      // Auto-detect
      documentTree = await StructuralParser.parse(doc_id, text, title);
    }

    // Count nodes
    const nodeCount = this.countNodes(documentTree);

    return {
      doc_id,
      documentTree,
      nodeCount,
    };
  }

  private countNodes(node: any): number {
    let count = 1;
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        count += this.countNodes(child);
      }
    }
    return count;
  }
}


export const structuralParser = (input: StructuralParserTaskInput, config?: JobQueueTaskConfig) => {
  return new StructuralParserTask({} as StructuralParserTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    structuralParser: CreateWorkflow<
      StructuralParserTaskInput,
      StructuralParserTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.structuralParser = CreateWorkflow(StructuralParserTask);
