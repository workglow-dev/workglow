/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  TypedArraySchema,
  TypedArraySchemaOptions,
  type DataPortSchemaObject,
  type FromSchema,
} from "@workglow/util";

/**
 * Schema for storing documents in tabular storage
 */
export const DocumentStorageSchema = {
  type: "object",
  properties: {
    doc_id: {
      type: "string",
      title: "Document ID",
      description: "Unique identifier for the document",
    },
    data: {
      type: "string",
      title: "Document Data",
      description: "JSON-serialized document",
    },
  },
  required: ["doc_id", "data"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export type DocumentStorageEntity = FromSchema<typeof DocumentStorageSchema>;

/**
 * Schema for vector storage in tabular format.
 * In-memory implementations may store vector as TypedArray directly,
 * while SQL implementations serialize to JSON string.
 */
export const VectorChunkStorageSchema = (dimensions: number | number[]) =>
  ({
    type: "object",
    properties: {
      id: { type: "string" },
      doc_id: { type: "string" },
      vector: TypedArraySchema({ "x-dimensions": dimensions }), // TypedArray in memory, vector(N) in PostgreSQL with pgvector
      metadata: { type: "object", format: "metadata", additionalProperties: true }, // TabularRepository handles JSON serialization
    },
    required: ["id", "doc_id", "vector", "metadata"],
    additionalProperties: true,
  }) as const satisfies DataPortSchemaObject;

export type VectorChunkStorageEntity = FromSchema<
  ReturnType<typeof VectorChunkStorageSchema>,
  TypedArraySchemaOptions
>;
