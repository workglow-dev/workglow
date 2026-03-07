/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DataPortSchemaObject,
  FromSchema,
  TypedArray,
  TypedArraySchemaOptions,
} from "@workglow/util";
import type {
  HybridSearchOptions,
  IVectorStorage,
  VectorSearchOptions,
} from "./IVectorStorage";
import { TelemetryTabularStorage } from "../tabular/TelemetryTabularStorage";
import { traced } from "../util/traced";

/**
 * Telemetry wrapper for any IVectorStorage implementation.
 * Extends TelemetryTabularStorage and adds spans for vector-specific operations.
 */
export class TelemetryVectorStorage<
  Metadata extends Record<string, unknown> | undefined,
  Schema extends DataPortSchemaObject,
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]> = ReadonlyArray<
    keyof Schema["properties"]
  >,
>
  extends TelemetryTabularStorage<Schema, PrimaryKeyNames, Entity>
  implements IVectorStorage<Metadata, Schema, Entity, PrimaryKeyNames>
{
  private readonly vectorInner: IVectorStorage<Metadata, Schema, Entity, PrimaryKeyNames>;

  constructor(
    storageName: string,
    inner: IVectorStorage<Metadata, Schema, Entity, PrimaryKeyNames>
  ) {
    super(storageName, inner as any);
    this.vectorInner = inner;
  }

  getVectorDimensions(): number {
    return this.vectorInner.getVectorDimensions();
  }

  similaritySearch(
    query: TypedArray,
    options?: VectorSearchOptions<Metadata>
  ): Promise<(Entity & { score: number })[]> {
    return traced("workglow.storage.vector.similaritySearch", this.storageName, () =>
      this.vectorInner.similaritySearch(query, options)
    );
  }

  hybridSearch(
    query: TypedArray,
    options: HybridSearchOptions<Metadata>
  ): Promise<(Entity & { score: number })[]> {
    if (!this.vectorInner.hybridSearch) {
      throw new Error("hybridSearch is not supported by the underlying storage implementation");
    }
    return traced("workglow.storage.vector.hybridSearch", this.storageName, () =>
      this.vectorInner.hybridSearch!(query, options)
    );
  }
}
