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
import { BaseTabularRepository } from "./BaseTabularRepository";
import {
  AnyTabularRepository,
  DeleteSearchCriteria,
  SimplifyPrimaryKey,
  TabularSubscribeOptions,
} from "./ITabularRepository";
import { InMemoryTabularRepository } from "./InMemoryTabularRepository";

export const SHARED_IN_MEMORY_TABULAR_REPOSITORY = createServiceToken<AnyTabularRepository>(
  "storage.tabularRepository.sharedInMemory"
);

/**
 * Message types for BroadcastChannel communication
 */
type BroadcastMessage =
  | { type: "SYNC_REQUEST" }
  | { type: "SYNC_RESPONSE"; data: any[] }
  | { type: "PUT"; entity: any }
  | { type: "PUT_BULK"; entities: any[] }
  | { type: "DELETE"; key: any }
  | { type: "DELETE_ALL" }
  | { type: "DELETE_SEARCH"; criteria: DeleteSearchCriteria<any> };

/**
 * A tabular repository implementation that shares data across browser tabs/windows
 * using BroadcastChannel API. Uses InMemoryTabularRepository internally and
 * synchronizes changes across all instances.
 *
 * @template Schema - The schema definition for the entity using JSON Schema
 * @template PrimaryKeyNames - Array of property names that form the primary key
 */
export class SharedInMemoryTabularRepository<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  // computed types
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
  PrimaryKey = SimplifyPrimaryKey<Entity, PrimaryKeyNames>,
> extends BaseTabularRepository<Schema, PrimaryKeyNames, Entity, PrimaryKey> {
  private channel: BroadcastChannel | null = null;
  private channelName: string;
  private inMemoryRepo: InMemoryTabularRepository<Schema, PrimaryKeyNames, Entity, PrimaryKey>;
  private isInitialized = false;
  private syncInProgress = false;

  /**
   * Creates a new SharedInMemoryTabularRepository instance
   * @param channelName - Unique name for the BroadcastChannel (defaults to "tabular_store")
   * @param schema - Schema defining the structure of the entity
   * @param primaryKeyNames - Array of property names that form the primary key
   * @param indexes - Array of columns or column arrays to make searchable. Each string or single column creates a single-column index,
   *                    while each array creates a compound index with columns in the specified order.
   */
  constructor(
    channelName: string = "tabular_store",
    schema: Schema,
    primaryKeyNames: PrimaryKeyNames,
    indexes: readonly (keyof Entity | readonly (keyof Entity)[])[] = []
  ) {
    super(schema, primaryKeyNames, indexes);
    this.channelName = channelName;
    this.inMemoryRepo = new InMemoryTabularRepository<Schema, PrimaryKeyNames, Entity, PrimaryKey>(
      schema,
      primaryKeyNames,
      indexes
    );

    // Forward events from the in-memory repository
    this.setupEventForwarding();

    // Initialize BroadcastChannel if available
    this.initializeBroadcastChannel();
  }

  /**
   * Checks if BroadcastChannel is available in the current environment
   */
  private isBroadcastChannelAvailable(): boolean {
    return typeof BroadcastChannel !== "undefined";
  }

  /**
   * Initializes the BroadcastChannel and sets up message handlers
   */
  private initializeBroadcastChannel(): void {
    if (!this.isBroadcastChannelAvailable()) {
      console.warn("BroadcastChannel is not available. Tab synchronization will not work.");
      return;
    }

    try {
      this.channel = new BroadcastChannel(this.channelName);
      this.channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
        this.handleBroadcastMessage(event.data);
      };

      // Request sync from other tabs on initialization
      this.syncFromOtherTabs();
    } catch (error) {
      console.error("Failed to initialize BroadcastChannel:", error);
    }
  }

  /**
   * Sets up event forwarding from the internal InMemoryTabularRepository
   */
  private setupEventForwarding(): void {
    this.inMemoryRepo.on("put", (entity) => {
      this.events.emit("put", entity);
    });
    this.inMemoryRepo.on("get", (key, entity) => {
      this.events.emit("get", key, entity);
    });
    this.inMemoryRepo.on("search", (key, entities) => {
      this.events.emit("search", key, entities);
    });
    this.inMemoryRepo.on("delete", (key) => {
      this.events.emit("delete", key);
    });
    this.inMemoryRepo.on("clearall", () => {
      this.events.emit("clearall");
    });
  }

  /**
   * Handles incoming BroadcastChannel messages
   */
  private async handleBroadcastMessage(message: BroadcastMessage): Promise<void> {
    if (this.syncInProgress && message.type !== "SYNC_RESPONSE") {
      // Ignore messages during sync to avoid race conditions
      return;
    }

    switch (message.type) {
      case "SYNC_REQUEST":
        // Respond to sync request with current data
        const all = await this.inMemoryRepo.getAll();
        if (this.channel && all) {
          this.channel.postMessage({
            type: "SYNC_RESPONSE",
            data: all,
          } as BroadcastMessage);
        }
        break;

      case "SYNC_RESPONSE":
        // Copy data from the responding tab
        if (message.data && Array.isArray(message.data)) {
          await this.copyDataFromArray(message.data);
        }
        this.syncInProgress = false;
        break;

      case "PUT":
        // Apply put from another tab
        await this.inMemoryRepo.put(message.entity);
        break;

      case "PUT_BULK":
        // Apply bulk put from another tab
        await this.inMemoryRepo.putBulk(message.entities);
        break;

      case "DELETE":
        // Apply delete from another tab
        await this.inMemoryRepo.delete(message.key);
        break;

      case "DELETE_ALL":
        // Apply deleteAll from another tab
        await this.inMemoryRepo.deleteAll();
        break;

      case "DELETE_SEARCH":
        // Apply deleteSearch from another tab
        await this.inMemoryRepo.deleteSearch(message.criteria as DeleteSearchCriteria<Entity>);
        break;
    }
  }

  /**
   * Requests synchronization from other tabs
   */
  private syncFromOtherTabs(): void {
    if (!this.channel) return;

    this.syncInProgress = true;
    this.channel.postMessage({ type: "SYNC_REQUEST" } as BroadcastMessage);

    // Set a timeout to stop waiting for sync response
    setTimeout(() => {
      this.syncInProgress = false;
    }, 1000);
  }

  /**
   * Copies data from an array of entities into the repository
   */
  private async copyDataFromArray(entities: Entity[]): Promise<void> {
    if (entities.length === 0) return;

    // Clear existing data
    await this.inMemoryRepo.deleteAll();

    // Bulk insert the new data
    await this.inMemoryRepo.putBulk(entities);
  }

  /**
   * Broadcasts a message to other tabs
   */
  private broadcast(message: BroadcastMessage): void {
    if (this.channel) {
      this.channel.postMessage(message);
    }
  }

  /**
   * Sets up the database for the repository (syncs from other tabs)
   */
  async setupDatabase(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;
    await this.syncFromOtherTabs();
  }

  /**
   * Stores a key-value pair in the repository
   * @param value - The combined object to store
   * @returns The stored entity
   * @emits 'put' event with the stored entity when successful
   */
  async put(value: Entity): Promise<Entity> {
    const result = await this.inMemoryRepo.put(value);
    this.broadcast({ type: "PUT", entity: value });
    return result;
  }

  /**
   * Stores multiple key-value pairs in the repository in a bulk operation
   * @param values - Array of combined objects to store
   * @returns Array of stored entities
   * @emits 'put' event for each value stored
   */
  async putBulk(values: Entity[]): Promise<Entity[]> {
    const result = await this.inMemoryRepo.putBulk(values);
    this.broadcast({ type: "PUT_BULK", entities: values });
    return result;
  }

  /**
   * Retrieves a value by its key
   * @param key - The primary key object to look up
   * @returns The value object if found, undefined otherwise
   * @emits 'get' event with the fingerprint ID and value when found
   */
  async get(key: PrimaryKey): Promise<Entity | undefined> {
    return await this.inMemoryRepo.get(key);
  }

  /**
   * Searches for entries matching a partial key
   * @param key - Partial key object to search for
   * @returns Array of matching combined objects
   * @throws Error if search criteria outside of searchable fields
   */
  async search(key: Partial<Entity>): Promise<Entity[] | undefined> {
    return await this.inMemoryRepo.search(key);
  }

  /**
   * Deletes an entry by its key
   * @param value - The primary key object or entity of the entry to delete
   * @emits 'delete' event with the fingerprint ID when successful
   */
  async delete(value: PrimaryKey | Entity): Promise<void> {
    await this.inMemoryRepo.delete(value);
    const { key } = this.separateKeyValueFromCombined(value as Entity);
    this.broadcast({ type: "DELETE", key });
  }

  /**
   * Removes all entries from the repository
   * @emits 'clearall' event when successful
   */
  async deleteAll(): Promise<void> {
    await this.inMemoryRepo.deleteAll();
    this.broadcast({ type: "DELETE_ALL" });
  }

  /**
   * Returns an array of all entries in the repository
   * @returns Array of all entries in the repository
   */
  async getAll(): Promise<Entity[] | undefined> {
    return await this.inMemoryRepo.getAll();
  }

  /**
   * Returns the number of entries in the repository
   * @returns The total count of stored entries
   */
  async size(): Promise<number> {
    return await this.inMemoryRepo.size();
  }

  /**
   * Deletes all entries matching the specified search criteria.
   * Supports multiple columns with optional comparison operators.
   *
   * @param criteria - Object with column names as keys and values or SearchConditions
   */
  async deleteSearch(criteria: DeleteSearchCriteria<Entity>): Promise<void> {
    await this.inMemoryRepo.deleteSearch(criteria);
    this.broadcast({
      type: "DELETE_SEARCH",
      criteria,
    });
  }

  /**
   * Subscribes to changes in the repository.
   * Delegates to the internal InMemoryTabularRepository which monitors local changes.
   * Changes from other tabs/windows are already propagated via BroadcastChannel.
   *
   * @param callback - Function called when a change occurs
   * @param options - Optional subscription options (not used for in-memory)
   * @returns Unsubscribe function
   */
  subscribeToChanges(
    callback: (change: any) => void,
    options?: TabularSubscribeOptions
  ): () => void {
    return this.inMemoryRepo.subscribeToChanges(callback, options);
  }

  /**
   * Cleanup method to close the BroadcastChannel
   */
  destroy(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.inMemoryRepo.destroy();
  }
}
