/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage, InMemoryVectorStorage } from "@workglow/storage";
import type { TypedArrayConstructor } from "@workglow/util/schema";
import type { ChunkVectorStorage } from "../chunk/ChunkVectorStorageSchema";
import { ChunkVectorPrimaryKey, ChunkVectorStorageSchema } from "../chunk/ChunkVectorStorageSchema";
import type { DocumentTabularStorage } from "../document/DocumentStorageSchema";
import { DocumentStorageKey, DocumentStorageSchema } from "../document/DocumentStorageSchema";
import { KnowledgeBase } from "./KnowledgeBase";
import { registerKnowledgeBase } from "./KnowledgeBaseRegistry";

export interface CreateKnowledgeBaseOptions<
  VectorCtor extends TypedArrayConstructor = typeof Float32Array,
> {
  readonly name: string;
  readonly vectorDimensions: number;
  readonly vectorCtor?: VectorCtor;
  readonly register?: boolean;
  readonly title?: string;
  readonly description?: string;
}

/**
 * Factory function to create a KnowledgeBase with minimal configuration.
 *
 * @example
 * ```typescript
 * const kb = await createKnowledgeBase({
 *   name: "my-kb",
 *   vectorDimensions: 1024,
 * });
 * ```
 */
export async function createKnowledgeBase<
  VectorCtor extends TypedArrayConstructor = typeof Float32Array,
>(options: CreateKnowledgeBaseOptions<VectorCtor>): Promise<KnowledgeBase> {
  const {
    name,
    vectorDimensions,
    vectorCtor: vectorCtorOption,
    register: shouldRegister = true,
    title,
    description,
  } = options;

  const vectorCtor = (vectorCtorOption ?? Float32Array) as VectorCtor;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new Error("createKnowledgeBase: 'name' must be a non-empty string");
  }
  if (
    typeof vectorDimensions !== "number" ||
    !Number.isInteger(vectorDimensions) ||
    vectorDimensions < 1
  ) {
    throw new Error("createKnowledgeBase: 'vectorDimensions' must be a positive integer");
  }

  const tabularStorage = new InMemoryTabularStorage(DocumentStorageSchema, DocumentStorageKey);
  await tabularStorage.setupDatabase();

  const vectorStorage = new InMemoryVectorStorage<
    typeof ChunkVectorStorageSchema,
    typeof ChunkVectorPrimaryKey,
    Record<string, unknown>,
    VectorCtor
  >(ChunkVectorStorageSchema, ChunkVectorPrimaryKey, [], vectorDimensions, vectorCtor);
  await vectorStorage.setupDatabase();

  const kb = new KnowledgeBase(
    name,
    tabularStorage as unknown as DocumentTabularStorage,
    vectorStorage as unknown as ChunkVectorStorage,
    title,
    description
  );

  if (shouldRegister) {
    await registerKnowledgeBase(name, kb);
  }

  return kb;
}
