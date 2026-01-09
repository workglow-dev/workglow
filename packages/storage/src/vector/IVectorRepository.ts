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
import type { ITabularRepository, TabularEventListeners } from "../tabular/ITabularRepository";

export type AnyVectorRepository = IVectorRepository<any, any, any>;

/**
 * Find the property with format: "metadata" and extract its type
 */
export type ExtractMetadataProperty<Schema extends DataPortSchemaObject> = {
  [K in keyof Schema["properties"]]: Schema["properties"][K] extends { format: "metadata" }
    ? K
    : never;
}[keyof Schema["properties"]];

/**
 * Options for vector search operations
 */
export interface VectorSearchOptions<Metadata = Record<string, unknown>> {
  topK?: number;
  filter?: Partial<Metadata>;
  scoreThreshold?: number;
}

/**
 * Options for hybrid search (vector + full-text)
 */
export interface HybridSearchOptions<
  Metadata = Record<string, unknown>,
> extends VectorSearchOptions<Metadata> {
  textQuery: string;
  vectorWeight?: number;
}

/**
 * Type definitions for vector repository events
 */
export interface VectorEventListeners<PrimaryKey, Entity> extends TabularEventListeners<
  PrimaryKey,
  Entity
> {
  similaritySearch: (query: TypedArray, results: (Entity & { score: number })[]) => void;
  hybridSearch: (query: TypedArray, results: (Entity & { score: number })[]) => void;
}

export type VectorEventName = keyof VectorEventListeners<any, any>;
export type VectorEventListener<
  Event extends VectorEventName,
  PrimaryKey,
  Entity,
> = VectorEventListeners<PrimaryKey, Entity>[Event];

export type VectorEventParameters<
  Event extends VectorEventName,
  PrimaryKey,
  Entity,
> = EventParameters<VectorEventListeners<PrimaryKey, Entity>, Event>;

/**
 * Interface defining the contract for vector storage repositories.
 * Extends ITabularRepository to provide standard storage operations,
 * plus vector-specific similarity search capabilities.
 * Supports various vector types including quantized formats.
 *
 * @typeParam Schema - The schema definition for the entity using JSON Schema
 * @typeParam PrimaryKeyNames - Array of property names that form the primary key
 * @typeParam Entity - The entity type
 * @typeParam PrimaryKey - The primary key type
 * @typeParam SearchResult - Type of search result including score and vector
 */
export interface IVectorRepository<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
> extends ITabularRepository<Schema, PrimaryKeyNames, Entity> {
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
