/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject, FromSchema } from "@workglow/util/schema";

/**
 * Schema for persisting KnowledgeBase metadata to tabular storage.
 */
export const KnowledgeBaseRecordSchema = {
  type: "object",
  properties: {
    kb_id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    vector_dimensions: { type: "integer" },
    document_table: { type: "string" },
    chunk_table: { type: "string" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
  required: [
    "kb_id",
    "title",
    "description",
    "vector_dimensions",
    "document_table",
    "chunk_table",
    "created_at",
    "updated_at",
  ],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type KnowledgeBaseRecord = FromSchema<typeof KnowledgeBaseRecordSchema>;
export const KnowledgeBasePrimaryKeyNames = ["kb_id"] as const;

/**
 * Generates SQL-safe table names for a knowledge base's document and chunk storage.
 */
/**
 * Checks whether a KnowledgeBaseRecord uses shared-table mode.
 */
export function isSharedTableMode(record: KnowledgeBaseRecord): boolean {
  // Avoid circular import — inline the constants
  return record.document_table === "shared_documents" && record.chunk_table === "shared_chunks";
}

export function knowledgeBaseTableNames(kbId: string): {
  readonly documentTable: string;
  readonly chunkTable: string;
} {
  const safe = kbId.replace(/[^a-zA-Z0-9_]/g, "_");
  return {
    documentTable: `kb_docs_${safe}`,
    chunkTable: `kb_chunks_${safe}`,
  };
}
