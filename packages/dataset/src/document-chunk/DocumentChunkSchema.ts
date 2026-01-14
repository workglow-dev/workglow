/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IVectorStorage } from "@workglow/storage";
import { TypedArraySchema, type DataPortSchemaObject, type TypedArray } from "@workglow/util";

/**
 * Default schema for document chunk storage with vector embeddings
 */
export const DocumentChunkSchema = {
  type: "object",
  properties: {
    chunk_id: { type: "string" },
    doc_id: { type: "string" },
    vector: TypedArraySchema(),
    metadata: { type: "object", format: "metadata", additionalProperties: true },
  },
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;
export type DocumentChunkSchema = typeof DocumentChunkSchema;

export const DocumentChunkPrimaryKey = ["chunk_id"] as const;
export type DocumentChunkPrimaryKey = typeof DocumentChunkPrimaryKey;

export interface DocumentChunk<
  Metadata extends Record<string, unknown> = Record<string, unknown>,
  Vector extends TypedArray = TypedArray,
> {
  chunk_id: string;
  doc_id: string;
  vector: Vector;
  metadata: Metadata;
}

export type DocumentChunkStorage = IVectorStorage<
  Record<string, unknown>,
  typeof DocumentChunkSchema,
  DocumentChunk
>;
