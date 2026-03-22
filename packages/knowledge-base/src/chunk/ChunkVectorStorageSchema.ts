/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IVectorStorage } from "@workglow/storage";
import { TypedArraySchema, type DataPortSchemaObject, type TypedArray } from "@workglow/util/schema";
import type { ChunkRecord } from "./ChunkSchema";

/**
 * Schema for chunk vector storage with typed metadata.
 * Replaces DocumentChunkSchema with ChunkRecord as the metadata type.
 */
export const ChunkVectorStorageSchema = {
  type: "object",
  properties: {
    chunk_id: { type: "string", "x-auto-generated": true },
    doc_id: { type: "string" },
    vector: TypedArraySchema(),
    metadata: { type: "object", format: "metadata", additionalProperties: true },
  },
  required: ["chunk_id", "doc_id", "vector", "metadata"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;
export type ChunkVectorStorageSchema = typeof ChunkVectorStorageSchema;

export const ChunkVectorPrimaryKey = ["chunk_id"] as const;
export type ChunkVectorPrimaryKey = typeof ChunkVectorPrimaryKey;

export interface ChunkVectorEntity<
  Metadata extends ChunkRecord = ChunkRecord,
  Vector extends TypedArray = TypedArray,
> {
  chunk_id: string;
  doc_id: string;
  vector: Vector;
  metadata: Metadata;
}

/**
 * Type for inserting chunk vectors - chunk_id is optional (auto-generated)
 */
export type InsertChunkVectorEntity<
  Metadata extends ChunkRecord = ChunkRecord,
  Vector extends TypedArray = TypedArray,
> = Omit<ChunkVectorEntity<Metadata, Vector>, "chunk_id"> &
  Partial<Pick<ChunkVectorEntity<Metadata, Vector>, "chunk_id">>;

/**
 * Type for the primary key of chunk vectors
 */
export type ChunkVectorKey = { chunk_id: string };

export type ChunkVectorStorage = IVectorStorage<
  ChunkRecord,
  typeof ChunkVectorStorageSchema,
  ChunkVectorEntity,
  ChunkVectorPrimaryKey
>;

/**
 * Search result with score
 */
export type ChunkSearchResult = ChunkVectorEntity & { score: number };
