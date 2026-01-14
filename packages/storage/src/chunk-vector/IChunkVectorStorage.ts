/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DataPortSchemaObject,
  EventParameters,
  FromSchema,
  TypedArray,
  TypedArraySchemaOptions,
} from "@workglow/util";
import type { ITabularStorage, TabularEventListeners } from "../tabular/ITabularStorage";

export type AnyChunkVectorStorage = IChunkVectorStorage<any, any, any>;

/**
 * Options for vector search operations
 */
export interface VectorSearchOptions<Metadata = Record<string, unknown>> {
  readonly topK?: number;
  readonly filter?: Partial<Metadata>;
  readonly scoreThreshold?: number;
}

/**
 * Options for hybrid search (vector + full-text)
 */
export interface HybridSearchOptions<
  Metadata = Record<string, unknown>,
> extends VectorSearchOptions<Metadata> {
  readonly textQuery: string;
  readonly vectorWeight?: number;
}

/**
 * Type definitions for document chunk vector repository events
 */
export interface VectorChunkEventListeners<PrimaryKey, Entity> extends TabularEventListeners<
  PrimaryKey,
  Entity
> {
  similaritySearch: (query: TypedArray, results: (Entity & { score: number })[]) => void;
  hybridSearch: (query: TypedArray, results: (Entity & { score: number })[]) => void;
}

export type VectorChunkEventName = keyof VectorChunkEventListeners<any, any>;
export type VectorChunkEventListener<
  Event extends VectorChunkEventName,
  PrimaryKey,
  Entity,
> = VectorChunkEventListeners<PrimaryKey, Entity>[Event];

export type VectorChunkEventParameters<
  Event extends VectorChunkEventName,
  PrimaryKey,
  Entity,
> = EventParameters<VectorChunkEventListeners<PrimaryKey, Entity>, Event>;

/**
 * Interface defining the contract for document chunk vector storage repositories.
 * These repositories store vector embeddings with metadata for decument chunks.
 * Extends ITabularRepository to provide standard storage operations,
 * plus vector-specific similarity search capabilities.
 * Supports various vector types including quantized formats.
 *
 * @typeParam Schema - The schema definition for the entity using JSON Schema
 * @typeParam PrimaryKeyNames - Array of property names that form the primary key
 * @typeParam Entity - The entity type
 */
export interface IChunkVectorStorage<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
> extends ITabularStorage<Schema, PrimaryKeyNames, Entity> {
  /**
   * Get the vector dimension
   * @returns The vector dimension
   */
  getVectorDimensions(): number;

  /**
   * Search for similar vectors using similarity scoring
   * @param query - Query vector to compare against
   * @param options - Search options (topK, filter, scoreThreshold)
   * @returns Array of search results sorted by similarity (highest first)
   */
  similaritySearch(
    query: TypedArray,
    options?: VectorSearchOptions<Record<string, unknown>>
  ): Promise<(Entity & { score: number })[]>;

  /**
   * Hybrid search combining vector similarity with full-text search
   * This is optional and may not be supported by all implementations
   * @param query - Query vector to compare against
   * @param options - Hybrid search options including text query
   * @returns Array of search results sorted by combined relevance
   */
  hybridSearch?(
    query: TypedArray,
    options: HybridSearchOptions<Record<string, unknown>>
  ): Promise<(Entity & { score: number })[]>;
}
