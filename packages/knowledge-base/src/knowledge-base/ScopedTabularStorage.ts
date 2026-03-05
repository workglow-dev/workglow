/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AnyTabularStorage,
  DeleteSearchCriteria,
  ITabularStorage,
  QueryOptions,
  SearchCriteria,
  TabularChangePayload,
  TabularEventListener,
  TabularEventName,
  TabularEventParameters,
  TabularSubscribeOptions,
} from "@workglow/storage";
import type { DataPortSchemaObject } from "@workglow/util";

/**
 * Wrapper implementing `ITabularStorage` that delegates to an inner shared
 * storage instance, injecting `kb_id` on writes and filtering by `kb_id` on
 * reads. The outer interface does not include `kb_id` — it is transparent to
 * the `KnowledgeBase` class.
 */
export class ScopedTabularStorage<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Entity = any,
  PrimaryKey = any,
  InsertType = any,
> implements ITabularStorage<Schema, PrimaryKeyNames, Entity, PrimaryKey, InsertType>
{
  protected readonly inner: AnyTabularStorage;
  protected readonly kbId: string;

  constructor(inner: AnyTabularStorage, kbId: string) {
    this.inner = inner;
    this.kbId = kbId;
  }

  private inject(value: any): any {
    return { ...value, kb_id: this.kbId };
  }

  private strip(entity: any): Entity {
    if (!entity) return entity;
    const { kb_id: _, ...rest } = entity;
    return rest as Entity;
  }

  private stripArray(entities: any[] | undefined): Entity[] | undefined {
    if (!entities) return undefined;
    return entities.map((e) => this.strip(e));
  }

  async put(value: InsertType): Promise<Entity> {
    const result = await this.inner.put(this.inject(value));
    return this.strip(result);
  }

  async putBulk(values: InsertType[]): Promise<Entity[]> {
    const injected = values.map((v) => this.inject(v));
    const results = await this.inner.putBulk(injected);
    return results.map((r: any) => this.strip(r));
  }

  async get(key: PrimaryKey): Promise<Entity | undefined> {
    const result = await this.inner.get(key as any);
    if (!result) return undefined;
    if ((result as any).kb_id !== this.kbId) return undefined;
    return this.strip(result);
  }

  async delete(key: PrimaryKey | Entity): Promise<void> {
    return this.inner.delete(key as any);
  }

  async getAll(options?: QueryOptions<Entity>): Promise<Entity[] | undefined> {
    const results = await this.inner.query({ kb_id: this.kbId } as any, options as any);
    return this.stripArray(results);
  }

  async deleteAll(): Promise<void> {
    await this.inner.deleteSearch({ kb_id: this.kbId } as any);
  }

  async size(): Promise<number> {
    const results = await this.inner.query({ kb_id: this.kbId } as any);
    return results ? results.length : 0;
  }

  async query(
    criteria: SearchCriteria<Entity>,
    options?: QueryOptions<Entity>
  ): Promise<Entity[] | undefined> {
    const results = await this.inner.query(
      { ...(criteria as any), kb_id: this.kbId },
      options as any
    );
    return this.stripArray(results);
  }

  async deleteSearch(criteria: DeleteSearchCriteria<Entity>): Promise<void> {
    await this.inner.deleteSearch({ ...(criteria as any), kb_id: this.kbId });
  }

  async getBulk(offset: number, limit: number): Promise<Entity[] | undefined> {
    const results = await this.inner.query({ kb_id: this.kbId } as any, { offset, limit });
    return this.stripArray(results);
  }

  async *records(pageSize: number = 100): AsyncGenerator<Entity, void, undefined> {
    if (pageSize <= 0) {
      throw new RangeError(`pageSize must be greater than 0, got ${pageSize}`);
    }
    let offset = 0;
    while (true) {
      const page = await this.getBulk(offset, pageSize);
      if (!page || page.length === 0) {
        break;
      }
      for (const entity of page) {
        yield entity;
      }
      if (page.length < pageSize) break;
      offset += pageSize;
    }
  }

  async *pages(pageSize: number = 100): AsyncGenerator<Entity[], void, undefined> {
    if (pageSize <= 0) {
      throw new RangeError(`pageSize must be greater than 0, got ${pageSize}`);
    }
    let offset = 0;
    while (true) {
      const page = await this.getBulk(offset, pageSize);
      if (!page || page.length === 0) {
        break;
      }
      yield page;
      if (page.length < pageSize) break;
      offset += pageSize;
    }
  }

  // Event delegation
  on<Event extends TabularEventName>(
    name: Event,
    fn: TabularEventListener<Event, PrimaryKey, Entity>
  ): void {
    this.inner.on(name, fn as any);
  }

  off<Event extends TabularEventName>(
    name: Event,
    fn: TabularEventListener<Event, PrimaryKey, Entity>
  ): void {
    this.inner.off(name, fn as any);
  }

  emit<Event extends TabularEventName>(
    name: Event,
    ...args: TabularEventParameters<Event, PrimaryKey, Entity>
  ): void {
    this.inner.emit(name, ...(args as any));
  }

  once<Event extends TabularEventName>(
    name: Event,
    fn: TabularEventListener<Event, PrimaryKey, Entity>
  ): void {
    this.inner.once(name, fn as any);
  }

  waitOn<Event extends TabularEventName>(
    name: Event
  ): Promise<TabularEventParameters<Event, PrimaryKey, Entity>> {
    return this.inner.waitOn(name) as any;
  }

  subscribeToChanges(
    callback: (change: TabularChangePayload<Entity>) => void,
    options?: TabularSubscribeOptions
  ): () => void {
    return this.inner.subscribeToChanges(callback as any, options);
  }

  // Lifecycle — no-op for shared storage
  async setupDatabase(): Promise<void> {
    // No-op: shared storage lifecycle is managed externally
  }

  destroy(): void {
    // No-op: shared storage lifecycle is managed externally
  }

  [Symbol.dispose](): void {
    // No-op
  }

  async [Symbol.asyncDispose](): Promise<void> {
    // No-op
  }
}
