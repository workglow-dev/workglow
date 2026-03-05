/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AnyVectorStorage,
  HybridSearchOptions,
  IVectorStorage,
  VectorSearchOptions,
} from "@workglow/storage";
import type { DataPortSchemaObject, TypedArray } from "@workglow/util";
import { ScopedTabularStorage } from "./ScopedTabularStorage";

/**
 * Wrapper extending `ScopedTabularStorage` that also implements `IVectorStorage`.
 * Delegates vector search methods to the inner shared vector storage,
 * post-filtering results by `kb_id`.
 */
export class ScopedVectorStorage<
    Metadata extends Record<string, unknown> | undefined,
    Schema extends DataPortSchemaObject,
    Entity = any,
    PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]> = ReadonlyArray<
      keyof Schema["properties"]
    >,
  >
  extends ScopedTabularStorage<Schema, PrimaryKeyNames, Entity>
  implements IVectorStorage<Metadata, Schema, Entity, PrimaryKeyNames>
{
  protected override readonly inner: AnyVectorStorage;

  constructor(inner: AnyVectorStorage, kbId: string) {
    super(inner, kbId);
    this.inner = inner;
  }

  getVectorDimensions(): number {
    return this.inner.getVectorDimensions();
  }

  async similaritySearch(
    query: TypedArray,
    options?: VectorSearchOptions<Metadata>
  ): Promise<(Entity & { score: number })[]> {
    const results = await this.inner.similaritySearch(query, {
      ...options,
      // Request extra results to account for post-filtering
      topK: options?.topK ? options.topK * 3 : undefined,
    } as any);

    const filtered = results
      .filter((r: any) => r.kb_id === this.kbId)
      .slice(0, options?.topK);

    return filtered.map((r: any) => {
      const { kb_id: _, ...rest } = r;
      return rest as Entity & { score: number };
    });
  }

  hybridSearch?(
    query: TypedArray,
    options: HybridSearchOptions<Metadata>
  ): Promise<(Entity & { score: number })[]>;
}

// Implement hybridSearch on the prototype so it matches the optional interface
ScopedVectorStorage.prototype.hybridSearch = async function (
  this: ScopedVectorStorage<any, any, any, any>,
  query: TypedArray,
  options: HybridSearchOptions<any>
): Promise<any[]> {
  if (typeof this.inner.hybridSearch !== "function") {
    throw new Error(
      "Hybrid search is not supported by the configured chunk storage backend. " +
        "Please use a vector storage implementation that provides `hybridSearch`."
    );
  }
  const results = await this.inner.hybridSearch(query, {
    ...options,
    topK: options?.topK ? options.topK * 3 : undefined,
  } as any);

  const filtered = results
    .filter((r: any) => r.kb_id === this.kbId)
    .slice(0, options?.topK);

  return filtered.map((r: any) => {
    const { kb_id: _, ...rest } = r;
    return rest;
  });
};
