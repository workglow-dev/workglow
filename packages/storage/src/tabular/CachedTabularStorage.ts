/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createServiceToken,
  DataPortSchemaObject,
  FromSchema,
  TypedArraySchemaOptions,
} from "@workglow/util";
import { BaseTabularStorage } from "./BaseTabularStorage";
import { InMemoryTabularStorage } from "./InMemoryTabularStorage";
import {
  AnyTabularStorage,
  DeleteSearchCriteria,
  ITabularStorage,
  SimplifyPrimaryKey,
  TabularSubscribeOptions,
} from "./ITabularStorage";

export const CACHED_TABULAR_REPOSITORY = createServiceToken<AnyTabularStorage>(
  "storage.tabularRepository.cached"
);

/**
 * A tabular repository wrapper that adds caching layer to a durable repository.
 * Uses InMemoryTabularStorage or SharedInMemoryTabularStorage as a cache
 * for faster access to frequently used data.
 *
 * @template Schema - The schema definition for the entity using JSON Schema
 * @template PrimaryKeyNames - Array of property names that form the primary key
 */
export class CachedTabularStorage<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  // computed types
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
  PrimaryKey = SimplifyPrimaryKey<Entity, PrimaryKeyNames>,
> extends BaseTabularStorage<Schema, PrimaryKeyNames, Entity, PrimaryKey> {
  public readonly cache: ITabularStorage<Schema, PrimaryKeyNames, Entity, PrimaryKey>;
  private durable: ITabularStorage<Schema, PrimaryKeyNames, Entity, PrimaryKey>;
  private cacheInitialized = false;

  /**
   * Creates a new CachedTabularStorage instance
   * @param durable - The durable repository to use as the source of truth
   * @param cache - Optional cache repository (InMemoryTabularStorage or SharedInMemoryTabularStorage).
   *                 If not provided, a new InMemoryTabularStorage will be created.
   * @param schema - Schema defining the structure of the entity
   * @param primaryKeyNames - Array of property names that form the primary key
   * @param indexes - Array of columns or column arrays to make searchable. Each string or single column creates a single-column index,
   *                    while each array creates a compound index with columns in the specified order.
   */
  constructor(
    durable: ITabularStorage<Schema, PrimaryKeyNames, Entity, PrimaryKey>,
    cache?: ITabularStorage<Schema, PrimaryKeyNames, Entity, PrimaryKey>,
    schema?: Schema,
    primaryKeyNames?: PrimaryKeyNames,
    indexes?: readonly (keyof Entity | readonly (keyof Entity)[])[]
  ) {
    // Extract schema and primaryKeyNames from durable repository if not provided
    // Note: This is a limitation - we can't always extract these from an interface
    // So we require them to be provided or assume they match
    if (!schema || !primaryKeyNames) {
      throw new Error(
        "Schema and primaryKeyNames must be provided when creating CachedTabularStorage"
      );
    }

    super(schema, primaryKeyNames, indexes || []);
    this.durable = durable;

    // Create cache if not provided
    if (cache) {
      this.cache = cache;
    } else {
      this.cache = new InMemoryTabularStorage<Schema, PrimaryKeyNames, Entity, PrimaryKey>(
        schema,
        primaryKeyNames,
        indexes || []
      );
    }

    // Forward events from both cache and durable
    this.setupEventForwarding();
  }

  /**
   * Sets up event forwarding from cache and durable repositories
   */
  private setupEventForwarding(): void {
    // Forward cache events
    this.cache.on("put", (entity) => {
      this.events.emit("put", entity);
    });
    this.cache.on("get", (key, entity) => {
      this.events.emit("get", key, entity);
    });
    this.cache.on("search", (key, entities) => {
      this.events.emit("search", key, entities);
    });
    this.cache.on("delete", (key) => {
      this.events.emit("delete", key);
    });
    this.cache.on("clearall", () => {
      this.events.emit("clearall");
    });
  }

  /**
   * Initializes the cache by loading all data from the durable repository
   */
  private async initializeCache(): Promise<void> {
    if (this.cacheInitialized) return;

    try {
      const all = await this.durable.getAll();
      if (all && all.length > 0) {
        await this.cache.putBulk(all);
      }
      this.cacheInitialized = true;
    } catch (error) {
      console.warn("Failed to initialize cache from durable repository:", error);
      this.cacheInitialized = true; // Mark as initialized even on error to avoid retry loops
    }
  }

  /**
   * Stores a key-value pair in both cache and durable repository
   * @param value - The combined object to store
   * @returns The stored entity
   * @emits 'put' event with the stored entity when successful
   */
  async put(value: Entity): Promise<Entity> {
    await this.initializeCache();

    // Write to durable first (source of truth)
    const result = await this.durable.put(value);

    // Then update cache
    await this.cache.put(result);

    return result;
  }

  /**
   * Stores multiple key-value pairs in both cache and durable repository
   * @param values - Array of combined objects to store
   * @returns Array of stored entities
   * @emits 'put' event for each value stored
   */
  async putBulk(values: Entity[]): Promise<Entity[]> {
    await this.initializeCache();

    // Write to durable first (source of truth)
    const results = await this.durable.putBulk(values);

    // Then update cache
    await this.cache.putBulk(results);

    return results;
  }

  /**
   * Retrieves a value by its key, checking cache first, then durable repository
   * @param key - The primary key object to look up
   * @returns The value object if found, undefined otherwise
   * @emits 'get' event with the fingerprint ID and value when found
   */
  async get(key: PrimaryKey): Promise<Entity | undefined> {
    await this.initializeCache();

    // Try cache first
    let result = await this.cache.get(key);

    // If not in cache, get from durable and cache it
    if (result === undefined) {
      result = await this.durable.get(key);
      if (result) {
        await this.cache.put(result);
      }
    }

    return result;
  }

  /**
   * Searches for entries matching a partial key
   * @param key - Partial key object to search for
   * @returns Array of matching combined objects
   * @throws Error if search criteria outside of searchable fields
   */
  async search(key: Partial<Entity>): Promise<Entity[] | undefined> {
    await this.initializeCache();

    // Try cache first
    let results = await this.cache.search(key);

    // If not found in cache, search durable and cache results
    if (results === undefined) {
      results = await this.durable.search(key);
      if (results && results.length > 0) {
        await this.cache.putBulk(results);
      }
    }

    return results;
  }

  /**
   * Deletes an entry from both cache and durable repository
   * @param value - The primary key object or entity of the entry to delete
   * @emits 'delete' event with the fingerprint ID when successful
   */
  async delete(value: PrimaryKey | Entity): Promise<void> {
    await this.initializeCache();

    // Delete from durable first (source of truth)
    await this.durable.delete(value);

    // Then delete from cache
    await this.cache.delete(value);
  }

  /**
   * Removes all entries from both cache and durable repository
   * @emits 'clearall' event when successful
   */
  async deleteAll(): Promise<void> {
    await this.initializeCache();

    // Delete from durable first (source of truth)
    await this.durable.deleteAll();

    // Then delete from cache
    await this.cache.deleteAll();
  }

  /**
   * Returns an array of all entries in the repository
   * @returns Array of all entries in the repository
   */
  async getAll(): Promise<Entity[] | undefined> {
    await this.initializeCache();

    // Try cache first
    let results = await this.cache.getAll();

    // If cache is empty, get from durable and populate cache
    if (!results || results.length === 0) {
      results = await this.durable.getAll();
      if (results && results.length > 0) {
        await this.cache.putBulk(results);
      }
    }

    return results;
  }

  /**
   * Returns the number of entries in the repository
   * @returns The total count of stored entries
   */
  async size(): Promise<number> {
    await this.initializeCache();

    // Get size from durable (source of truth)
    return await this.durable.size();
  }

  /**
   * Deletes all entries matching the specified search criteria.
   * Supports multiple columns with optional comparison operators.
   *
   * @param criteria - Object with column names as keys and values or SearchConditions
   */
  async deleteSearch(criteria: DeleteSearchCriteria<Entity>): Promise<void> {
    await this.initializeCache();

    // Delete from durable first (source of truth)
    await this.durable.deleteSearch(criteria);

    // Then delete from cache
    await this.cache.deleteSearch(criteria);
  }

  /**
   * Invalidates the cache by clearing it and resetting initialization flag
   */
  async invalidateCache(): Promise<void> {
    await this.cache.deleteAll();
    this.cacheInitialized = false;
  }

  /**
   * Refreshes the cache by reloading all data from the durable repository
   */
  async refreshCache(): Promise<void> {
    await this.cache.deleteAll();
    this.cacheInitialized = false;
    await this.initializeCache();
  }

  /**
   * Subscribes to changes in the repository.
   * Delegates to the durable repository to detect changes (including from other sources).
   * Also updates the cache when changes are detected.
   *
   * @param callback - Function called when a change occurs
   * @param options - Optional subscription options (e.g., polling interval)
   * @returns Unsubscribe function
   */
  subscribeToChanges(
    callback: (change: any) => void,
    options?: TabularSubscribeOptions
  ): () => void {
    // Subscribe to durable repository to detect all changes
    return this.durable.subscribeToChanges(async (change) => {
      // Update cache based on the change
      if (change.type === "INSERT" || change.type === "UPDATE") {
        if (change.new) {
          await this.cache.put(change.new);
        }
      } else if (change.type === "DELETE") {
        if (change.old) {
          await this.cache.delete(change.old);
        }
      }

      // Forward the change to the callback
      callback(change);
    }, options);
  }

  /**
   * Destroys the durable and cache repositories.
   */
  destroy(): void {
    this.durable.destroy();
    this.cache.destroy();
  }
}
