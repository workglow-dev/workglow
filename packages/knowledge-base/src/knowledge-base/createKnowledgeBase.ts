/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage, InMemoryVectorStorage } from "@workglow/storage";
import type { TypedArray } from "@workglow/util";
import { ChunkVectorPrimaryKey, ChunkVectorStorageSchema } from "../chunk/ChunkVectorStorageSchema";
import type { ChunkVectorStorage } from "../chunk/ChunkVectorStorageSchema";
import { DocumentStorageKey, DocumentStorageSchema } from "../document/DocumentStorageSchema";
import type { DocumentTabularStorage } from "../document/DocumentStorageSchema";
import { KnowledgeBase } from "./KnowledgeBase";
import { registerKnowledgeBase } from "./KnowledgeBaseRegistry";

export interface CreateKnowledgeBaseOptions {
  readonly name: string;
  readonly vectorDimensions: number;
  readonly vectorType?: { new (array: number[]): TypedArray };
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
export async function createKnowledgeBase(
  options: CreateKnowledgeBaseOptions
): Promise<KnowledgeBase> {
  const {
    name,
    vectorDimensions,
    vectorType = Float32Array,
    register: shouldRegister = true,
    title,
    description,
  } = options;

  const tabularStorage = new InMemoryTabularStorage(DocumentStorageSchema, DocumentStorageKey);
  await tabularStorage.setupDatabase();

  const vectorStorage = new InMemoryVectorStorage(
    ChunkVectorStorageSchema,
    ChunkVectorPrimaryKey,
    [],
    vectorDimensions,
    vectorType
  );
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
