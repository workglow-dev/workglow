/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TypedArraySchema, type DataPortSchemaObject } from "@workglow/util/schema";

/**
 * Default table names for shared-table mode.
 */
export const SHARED_DOCUMENT_TABLE = "shared_documents";
export const SHARED_CHUNK_TABLE = "shared_chunks";

/**
 * Augmented document storage schema with kb_id column for shared-table mode.
 */
export const SharedDocumentStorageSchema = {
  type: "object",
  properties: {
    doc_id: {
      type: "string",
      "x-auto-generated": true,
      title: "Document ID",
      description: "Unique identifier for the document",
    },
    kb_id: {
      type: "string",
      title: "Knowledge Base ID",
      description: "Owning knowledge base identifier",
    },
    data: {
      type: "string",
      title: "Document Data",
      description: "JSON-serialized document",
    },
    metadata: {
      type: "object",
      title: "Metadata",
      description: "Metadata of the document",
    },
  },
  required: ["doc_id", "kb_id", "data"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

/**
 * Augmented chunk vector storage schema with kb_id column for shared-table mode.
 */
export const SharedChunkVectorStorageSchema = {
  type: "object",
  properties: {
    chunk_id: { type: "string", "x-auto-generated": true },
    kb_id: { type: "string" },
    doc_id: { type: "string" },
    vector: TypedArraySchema(),
    metadata: { type: "object", format: "metadata", additionalProperties: true },
  },
  required: ["chunk_id", "kb_id", "doc_id", "vector", "metadata"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

/**
 * Index definitions for efficient KB-scoped queries on shared document table.
 */
export const SharedDocumentIndexes: ReadonlyArray<ReadonlyArray<string>> = [["kb_id"]];

/**
 * Index definitions for efficient KB-scoped queries on shared chunk table.
 */
export const SharedChunkIndexes: ReadonlyArray<ReadonlyArray<string>> = [
  ["kb_id"],
  ["kb_id", "doc_id"],
];
