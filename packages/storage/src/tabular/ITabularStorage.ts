/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DataPortSchemaObject,
  EventParameters,
  FromSchema,
  TypedArraySchemaOptions,
} from "@workglow/util";

// Generic type for possible value types in the repository
export type ValueOptionType = string | number | bigint | boolean | null | Uint8Array;

/**
 * Type definitions for tabular repository events
 */
export type TabularEventListeners<PrimaryKey, Entity> = {
  put: (entity: Entity) => void;
  get: (key: PrimaryKey, entity: Entity | undefined) => void;
  search: (key: Partial<Entity>, entities: Entity[] | undefined) => void;
  delete: (key: keyof Entity) => void;
  clearall: () => void;
};

export type TabularEventName = keyof TabularEventListeners<any, any>;
export type TabularEventListener<
  Event extends TabularEventName,
  PrimaryKey,
  Entity,
> = TabularEventListeners<PrimaryKey, Entity>[Event];

export type TabularEventParameters<
  Event extends TabularEventName,
  PrimaryKey,
  Entity,
> = EventParameters<TabularEventListeners<PrimaryKey, Entity>, Event>;

/**
 * Type of change that occurred in the repository
 */
export type TabularChangeType = "INSERT" | "UPDATE" | "DELETE";

/**
 * Payload describing a change to an entity
 */
export interface TabularChangePayload<Entity> {
  readonly type: TabularChangeType;
  readonly old?: Entity;
  readonly new?: Entity;
}

/**
 * Options for subscribing to changes in a tabular repository
 */
export interface TabularSubscribeOptions {
  /** Polling interval in milliseconds (used by implementations that rely on polling) */
  readonly pollingIntervalMs?: number;
}

// Type definitions for specialized string types
export type uuid4 = string & { readonly __brand: "uuid4" };
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

/**
 * Comparison operators for search and deleteSearch operations
 */
export type SearchOperator = "=" | "<" | "<=" | ">" | ">=";

/**
 * A search condition with a value and comparison operator
 */
export interface SearchCondition<T> {
  readonly value: T;
  readonly operator: SearchOperator;
}

/**
 * Criteria for deleteSearch operations supporting multiple columns.
 * Each column can have either a direct value (equality) or a SearchCondition with an operator.
 *
 * @example
 * // Equality match
 * { category: "electronics" }
 *
 * // With operator
 * { createdAt: { value: date, operator: "<" } }
 *
 * // Multiple columns
 * { category: "electronics", createdAt: { value: date, operator: "<" } }
 */
export type DeleteSearchCriteria<Entity> = {
  readonly [K in keyof Entity]?: Entity[K] | SearchCondition<Entity[K]>;
};

/**
 * Type guard to check if a value is a SearchCondition
 */
export function isSearchCondition<T>(value: unknown): value is SearchCondition<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "operator" in value &&
    typeof (value as SearchCondition<T>).operator === "string"
  );
}

/**
 * Helper type to compute PrimaryKey while deferring Entity resolution.
 * Uses a conditional type to avoid forcing full Entity resolution at class definition time.
 *
 */
export type SimplifyPrimaryKey<
  Entity,
  KeyName extends ReadonlyArray<keyof any>,
> = Entity extends any ? Pick<Entity, Extract<KeyName[number], keyof Entity>> : never;

/**
 * Interface defining the contract for tabular storage repositories.
 * Provides a flexible interface for storing and retrieving data with typed
 * primary keys and values, and supports compound keys and partial key lookup.
 *
 * @typeParam Schema - The schema definition for the entity using JSON Schema
 * @typeParam PrimaryKeyNames - Array of property names that form the primary key
 */
export interface ITabularStorage<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  // computed types
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
  PrimaryKey = SimplifyPrimaryKey<Entity, PrimaryKeyNames>,
> {
  // Core methods
  put(value: Entity): Promise<Entity>;
  putBulk(values: Entity[]): Promise<Entity[]>;
  get(key: PrimaryKey): Promise<Entity | undefined>;
  delete(key: PrimaryKey | Entity): Promise<void>;
  getAll(): Promise<Entity[] | undefined>;
  deleteAll(): Promise<void>;
  size(): Promise<number>;
  /**
   * Deletes all entries matching the specified search criteria.
   * Supports multiple columns with optional comparison operators.
   *
   * @param criteria - Object with column names as keys and values or SearchConditions
   * @example
   * // Delete by equality
   * await repo.deleteSearch({ category: "electronics" });
   *
   * // Delete with operator
   * await repo.deleteSearch({ createdAt: { value: date, operator: "<" } });
   *
   * // Delete with multiple criteria (AND)
   * await repo.deleteSearch({ category: "electronics", value: { value: 100, operator: "<" } });
   */
  deleteSearch(criteria: DeleteSearchCriteria<Entity>): Promise<void>;

  // Event handling methods
  on<Event extends TabularEventName>(
    name: Event,
    fn: TabularEventListener<Event, PrimaryKey, Entity>
  ): void;
  off<Event extends TabularEventName>(
    name: Event,
    fn: TabularEventListener<Event, PrimaryKey, Entity>
  ): void;
  emit<Event extends TabularEventName>(
    name: Event,
    ...args: TabularEventParameters<Event, PrimaryKey, Entity>
  ): void;
  once<Event extends TabularEventName>(
    name: Event,
    fn: TabularEventListener<Event, PrimaryKey, Entity>
  ): void;
  waitOn<Event extends TabularEventName>(
    name: Event
  ): Promise<TabularEventParameters<Event, PrimaryKey, Entity>>;

  // Convenience methods
  search(key: Partial<Entity>): Promise<Entity[] | undefined>;

  /**
   * Subscribes to changes in the repository (including remote changes).
   * @param callback - Function called when a change occurs
   * @param options - Optional subscription options (e.g., polling interval)
   * @returns Unsubscribe function
   */
  subscribeToChanges(
    callback: (change: TabularChangePayload<Entity>) => void,
    options?: TabularSubscribeOptions
  ): () => void;

  /**
   * Sets up the database/storage for the repository.
   * Must be called before using any other methods (except for in-memory implementations).
   * @returns Promise that resolves when setup is complete
   */
  setupDatabase(): Promise<void>;

  // Destroy the repository and frees up resources.
  destroy(): void;
  [Symbol.dispose](): void;
  [Symbol.asyncDispose](): Promise<void>;
}

export type AnyTabularStorage = ITabularStorage<any, any, any, any>;
