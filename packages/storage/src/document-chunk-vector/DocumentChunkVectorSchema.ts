/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TypedArraySchema, type DataPortSchemaObject, type TypedArray } from "@workglow/util";

/**
 * Default schema for document chunk storage with vector embeddings
 */
export const DocumentChunkVectorSchema = {
  type: "object",
  properties: {
    chunk_id: { type: "string" },
    doc_id: { type: "string" },
    vector: TypedArraySchema(),
    metadata: { type: "object", additionalProperties: true },
  },
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;
export type DocumentChunkVectorSchema = typeof DocumentChunkVectorSchema;

export const DocumentChunkVectorKey = ["chunk_id"] as const;
export type DocumentChunkVectorKey = typeof DocumentChunkVectorKey;

export interface DocumentChunkVector<
  Metadata extends Record<string, unknown> = Record<string, unknown>,
  Vector extends TypedArray = Float32Array,
> {
  chunk_id: string;
  doc_id: string;
  vector: Vector;
  metadata: Metadata;
}
