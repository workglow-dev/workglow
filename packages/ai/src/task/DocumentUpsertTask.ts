/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Document, KnowledgeBase, TypeKnowledgeBase } from "@workglow/knowledge-base";
import type { DocumentNode } from "@workglow/knowledge-base";
import { CreateWorkflow, IExecuteContext, Task, Workflow } from "@workglow/task-graph";
import type { TaskConfig } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";

const inputSchema = {
  type: "object",
  properties: {
    knowledgeBase: TypeKnowledgeBase({
      title: "Knowledge Base",
      description: "The knowledge base instance to store the document in",
    }),
    doc_id: {
      type: "string",
      title: "Document ID",
      description: "The document ID (from the parser)",
    },
    documentTree: {
      title: "Document Tree",
      description: "The hierarchical document tree to persist",
    },
    title: {
      type: "string",
      title: "Title",
      description: "Human-readable title stored in the document metadata",
    },
  },
  required: ["knowledgeBase", "doc_id", "documentTree", "title"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    doc_id: {
      type: "string",
      title: "Document ID",
      description: "The document ID (passed through after persistence)",
    },
  },
  required: ["doc_id"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type DocumentUpsertTaskInput = FromSchema<typeof inputSchema>;
export type DocumentUpsertTaskOutput = FromSchema<typeof outputSchema>;
export type DocumentUpsertTaskConfig = TaskConfig<DocumentUpsertTaskInput>;

/**
 * Persists a parsed document tree to a knowledge base. Sits between
 * `StructuralParserTask` and `HierarchicalChunkerTask` in a typical RAG
 * ingest pipeline so that the document row exists in tabular storage
 * before any chunk-vector row references its `doc_id`.
 *
 * Pure side-effect task: input `doc_id` is preserved on the output so
 * downstream tasks can chain on the upsert completing successfully.
 */
export class DocumentUpsertTask extends Task<
  DocumentUpsertTaskInput,
  DocumentUpsertTaskOutput,
  DocumentUpsertTaskConfig
> {
  public static override type = "DocumentUpsertTask";
  public static override category = "Vector Store";
  public static override title = "Add Document";
  public static override description = "Persist a parsed document tree to a knowledge base";
  public static override cacheable = false; // Has side effects

  public static override inputSchema(): DataPortSchema {
    return inputSchema as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return outputSchema as DataPortSchema;
  }

  override async execute(
    input: DocumentUpsertTaskInput,
    context: IExecuteContext
  ): Promise<DocumentUpsertTaskOutput> {
    const { knowledgeBase, doc_id, documentTree, title } = input;
    const kb = knowledgeBase as KnowledgeBase;

    await context.updateProgress(1, "Upserting document");

    const document = new Document(documentTree as DocumentNode, { title }, [], doc_id);
    const stored = await kb.upsertDocument(document);

    return {
      doc_id: stored.doc_id ?? doc_id,
    };
  }
}

export const documentUpsert = (
  input: DocumentUpsertTaskInput,
  config?: DocumentUpsertTaskConfig
) => {
  return new DocumentUpsertTask(config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    documentUpsert: CreateWorkflow<
      DocumentUpsertTaskInput,
      DocumentUpsertTaskOutput,
      DocumentUpsertTaskConfig
    >;
  }
}

Workflow.prototype.documentUpsert = CreateWorkflow(DocumentUpsertTask);
