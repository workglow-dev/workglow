/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import type { EventParameters } from "@workglow/util";
import { EventEmitter } from "@workglow/util";
import type { FromSchema } from "@workglow/util/schema";

import type { KnowledgeBaseRecord } from "./KnowledgeBaseSchema";
import { KnowledgeBasePrimaryKeyNames, KnowledgeBaseRecordSchema } from "./KnowledgeBaseSchema";

/**
 * Events that can be emitted by the KnowledgeBaseRepository
 */

export type KnowledgeBaseEventListeners = {
  knowledge_base_added: (record: KnowledgeBaseRecord) => void;
  knowledge_base_removed: (record: KnowledgeBaseRecord) => void;
  knowledge_base_updated: (record: KnowledgeBaseRecord) => void;
};

export type KnowledgeBaseEvents = keyof KnowledgeBaseEventListeners;

export type KnowledgeBaseEventListener<Event extends KnowledgeBaseEvents> =
  KnowledgeBaseEventListeners[Event];

export type KnowledgeBaseEventParameters<Event extends KnowledgeBaseEvents> = EventParameters<
  KnowledgeBaseEventListeners,
  Event
>;

/**
 * Repository for persisting KnowledgeBase metadata to tabular storage.
 * Follows the same pattern as ModelRepository.
 *
 * @typeParam S - Schema type (defaults to base KnowledgeBaseRecordSchema). Pass a wider
 *   schema to get correctly-typed method signatures throughout the subclass.
 * @typeParam PK - Primary key names tuple (defaults to ["kb_id"]).
 */
export class KnowledgeBaseRepository<
  S extends typeof KnowledgeBaseRecordSchema = typeof KnowledgeBaseRecordSchema,
  PK extends typeof KnowledgeBasePrimaryKeyNames = typeof KnowledgeBasePrimaryKeyNames,
> {
  /**
   * Storage for KnowledgeBase records
   */
  protected readonly storage: ITabularStorage<S, PK>;

  constructor(storage: ITabularStorage<S, PK>) {
    this.storage = storage;
  }

  /** Event emitter for repository events */
  protected events = new EventEmitter<KnowledgeBaseEventListeners>();

  /**
   * Sets up the database for the repository.
   * Must be called before using any other methods.
   */
  async setupDatabase(): Promise<void> {
    await this.storage.setupDatabase?.();
  }

  /**
   * Registers an event listener for the specified event
   */
  on<Event extends KnowledgeBaseEvents>(name: Event, fn: KnowledgeBaseEventListener<Event>) {
    this.events.on(name, fn);
  }

  /**
   * Removes an event listener for the specified event
   */
  off<Event extends KnowledgeBaseEvents>(name: Event, fn: KnowledgeBaseEventListener<Event>) {
    this.events.off(name, fn);
  }

  /**
   * Adds an event listener that will only be called once
   */
  once<Event extends KnowledgeBaseEvents>(name: Event, fn: KnowledgeBaseEventListener<Event>) {
    this.events.once(name, fn);
  }

  /**
   * Returns when the event was emitted (promise form of once)
   */
  waitOn<Event extends KnowledgeBaseEvents>(name: Event) {
    return this.events.waitOn(name);
  }

  /**
   * Adds a new knowledge base record to the repository
   */
  async addKnowledgeBase(record: FromSchema<S>): Promise<FromSchema<S>> {
    await this.storage.put(record as any);
    this.events.emit("knowledge_base_added", record as unknown as KnowledgeBaseRecord);
    return record;
  }

  /**
   * Removes a knowledge base record from the repository
   */
  async removeKnowledgeBase(kb_id: string): Promise<void> {
    const record = await this.storage.get({ kb_id } as any);
    if (!record) {
      throw new Error(`KnowledgeBase with id "${kb_id}" not found`);
    }
    await this.storage.delete({ kb_id } as any);
    this.events.emit("knowledge_base_removed", record as unknown as KnowledgeBaseRecord);
  }

  /**
   * Retrieves a knowledge base record by ID
   */
  async getKnowledgeBase(kb_id: string): Promise<FromSchema<S> | undefined> {
    if (typeof kb_id !== "string") return undefined;
    const record = await this.storage.get({ kb_id } as any);
    return record ?? undefined;
  }

  /**
   * Enumerates all knowledge base records
   */
  async enumerateAll(): Promise<FromSchema<S>[]> {
    const records = await this.storage.getAll();
    if (!records || records.length === 0) return [];
    return records as FromSchema<S>[];
  }

  /**
   * Gets the total number of knowledge base records
   */
  async size(): Promise<number> {
    return await this.storage.size();
  }
}
