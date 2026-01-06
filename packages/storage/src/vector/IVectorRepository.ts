/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventParameters, TypedArray } from "@workglow/util";

/**
 * A vector entry with its associated metadata
 */
export interface VectorEntry<
  Metadata = Record<string, unknown>,
  VectorChoice extends TypedArray = Float32Array,
> {
  readonly id: string;
  readonly vector: VectorChoice;
  readonly metadata: Metadata;
}

/**
 * A search result with similarity score
 */
export interface SearchResult<
  Metadata = Record<string, unknown>,
  VectorChoice extends TypedArray = Float32Array,
> {
  readonly id: string;
  readonly vector: VectorChoice;
  readonly metadata: Metadata;
  readonly score: number;
}

/**
 * Options for vector search operations
 */
export interface VectorSearchOptions<
  Metadata = Record<string, unknown>,
  VectorChoice extends TypedArray = Float32Array,
> {
  /** Maximum number of results to return */
  topK?: number;
  /** Filter by metadata fields */
  filter?: Partial<Metadata>;
  /** Minimum similarity score threshold */
  scoreThreshold?: number;
}

/**
 * Options for hybrid search (vector + full-text)
 */
export interface HybridSearchOptions<
  Metadata = Record<string, unknown>,
  VectorChoice extends TypedArray = Float32Array,
> extends VectorSearchOptions<Metadata, VectorChoice> {
  /** Full-text query string */
  textQuery: string;
  /** Weight for vector similarity (0-1), remainder goes to text relevance */
  vectorWeight?: number;
}

/**
 * Type definitions for vector repository events
 */
export type VectorEventListeners<Metadata, VectorChoice extends TypedArray = Float32Array> = {
  upsert: (entry: VectorEntry<Metadata, VectorChoice>) => void;
  delete: (id: string) => void;
  search: (query: VectorChoice, results: SearchResult<Metadata, VectorChoice>[]) => void;
};

export type VectorEventName = keyof VectorEventListeners<any, any>;
export type VectorEventListener<
  Event extends VectorEventName,
  Metadata,
  VectorChoice extends TypedArray = Float32Array,
> = VectorEventListeners<Metadata, VectorChoice>[Event];

export type VectorEventParameters<
  Event extends VectorEventName,
  Metadata,
  VectorChoice extends TypedArray = Float32Array,
> = EventParameters<VectorEventListeners<Metadata, VectorChoice>, Event>;

/**
 * Interface defining the contract for vector storage repositories.
 * Provides operations for storing, retrieving, and searching vector embeddings.
 * Supports various vector types including quantized formats.
 *
 * @typeParam Metadata - Type for metadata associated with vectors
 * @typeParam VectorChoice - Type of vector array (Float32Array, Int8Array, etc.)
 */
export interface IVectorRepository<
  Metadata = Record<string, unknown>,
  VectorChoice extends TypedArray = Float32Array,
> {
  /**
   * Upsert a vector entry (insert or update)
   * @param id - Unique identifier for the vector
   * @param vector - The vector embedding (Float32Array, Int8Array, etc.)
   * @param metadata - Associated metadata
   */
  upsert(id: string, vector: VectorChoice, metadata: Metadata): Promise<void>;

  /**
   * Upsert multiple vector entries in bulk
   * @param items - Array of vector entries to upsert
   */
  upsertBulk(items: VectorEntry<Metadata, VectorChoice>[]): Promise<void>;

  /**
   * Search for similar vectors
   * @param query - Query vector to compare against
   * @param options - Search options (topK, filter, scoreThreshold)
   * @returns Array of search results sorted by similarity (highest first)
   */
  search(
    query: VectorChoice,
    options?: VectorSearchOptions<Metadata, VectorChoice>
  ): Promise<SearchResult<Metadata, VectorChoice>[]>;

  /**
   * Hybrid search combining vector similarity with full-text search
   * This is optional and may not be supported by all implementations
   * @param query - Query vector to compare against
   * @param options - Hybrid search options including text query
   * @returns Array of search results sorted by combined relevance
   */
  hybridSearch?(
    query: VectorChoice,
    options: HybridSearchOptions<Metadata, VectorChoice>
  ): Promise<SearchResult<Metadata, VectorChoice>[]>;

  /**
   * Get a vector entry by ID
   * @param id - Unique identifier
   * @returns The vector entry or undefined if not found
   */
  get(id: string): Promise<VectorEntry<Metadata, VectorChoice> | undefined>;

  /**
   * Delete a vector entry by ID
   * @param id - Unique identifier
   */
  delete(id: string): Promise<void>;

  /**
   * Delete multiple vector entries by IDs
   * @param ids - Array of unique identifiers
   */
  deleteBulk(ids: string[]): Promise<void>;

  /**
   * Delete vectors matching metadata filter
   * @param filter - Partial metadata to match
   */
  deleteByFilter(filter: Partial<Metadata>): Promise<void>;

  /**
   * Get the number of vectors stored
   * @returns Total count of vectors
   */
  size(): Promise<number>;

  /**
   * Clear all vectors from the repository
   */
  clear(): Promise<void>;

  /**
   * Set up the repository (create tables, indexes, etc.)
   * Must be called before using other methods
   */
  setupDatabase(): Promise<void>;

  /**
   * Destroy the repository and free resources
   */
  destroy(): void;

  // Event handling methods
  on<Event extends VectorEventName>(
    name: Event,
    fn: VectorEventListener<Event, Metadata, VectorChoice>
  ): void;
  off<Event extends VectorEventName>(
    name: Event,
    fn: VectorEventListener<Event, Metadata, VectorChoice>
  ): void;
  emit<Event extends VectorEventName>(
    name: Event,
    ...args: VectorEventParameters<Event, Metadata, VectorChoice>
  ): void;
  once<Event extends VectorEventName>(
    name: Event,
    fn: VectorEventListener<Event, Metadata, VectorChoice>
  ): void;
  waitOn<Event extends VectorEventName>(
    name: Event
  ): Promise<VectorEventParameters<Event, Metadata, VectorChoice>>;
}
