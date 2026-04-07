/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createServiceToken,
  globalServiceRegistry,
  registerInputCompactor,
  registerInputResolver,
  ServiceRegistry,
} from "@workglow/util";
import { InMemoryKnowledgeBaseRepository } from "./InMemoryKnowledgeBaseRepository";
import type { KnowledgeBase } from "./KnowledgeBase";
import { KnowledgeBaseRepository } from "./KnowledgeBaseRepository";
import { knowledgeBaseTableNames } from "./KnowledgeBaseSchema";
import type { KnowledgeBaseRecord } from "./KnowledgeBaseSchema";

/**
 * Service token for the knowledge base registry
 * Maps knowledge base IDs to KnowledgeBase instances
 */
export const KNOWLEDGE_BASES =
  createServiceToken<Map<string, KnowledgeBase>>("knowledge-base.registry");

/**
 * Service token for the knowledge base repository
 */
export const KNOWLEDGE_BASE_REPOSITORY = createServiceToken<KnowledgeBaseRepository>(
  "knowledge-base.repository"
);

// Register default factory for live KB map if not already registered
if (!globalServiceRegistry.has(KNOWLEDGE_BASES)) {
  globalServiceRegistry.register(
    KNOWLEDGE_BASES,
    (): Map<string, KnowledgeBase> => new Map(),
    true
  );
}

// Register default factory for KB repository if not already registered
if (!globalServiceRegistry.has(KNOWLEDGE_BASE_REPOSITORY)) {
  globalServiceRegistry.register(
    KNOWLEDGE_BASE_REPOSITORY,
    (): KnowledgeBaseRepository => new InMemoryKnowledgeBaseRepository(),
    true
  );
}

/**
 * Gets the global knowledge base registry
 */
export function getGlobalKnowledgeBases(): Map<string, KnowledgeBase> {
  return globalServiceRegistry.get(KNOWLEDGE_BASES);
}

/**
 * Gets the global knowledge base repository instance
 */
export function getGlobalKnowledgeBaseRepository(): KnowledgeBaseRepository {
  return globalServiceRegistry.get(KNOWLEDGE_BASE_REPOSITORY);
}

/**
 * Sets the global knowledge base repository instance
 */
export function setGlobalKnowledgeBaseRepository(repository: KnowledgeBaseRepository): void {
  globalServiceRegistry.registerInstance(KNOWLEDGE_BASE_REPOSITORY, repository);
}

/**
 * Registers a knowledge base globally by ID.
 * Adds to both the live Map and the persistent repository.
 */
export async function registerKnowledgeBase(id: string, kb: KnowledgeBase): Promise<void> {
  const kbs = getGlobalKnowledgeBases();

  const now = new Date().toISOString();
  const tableNames = knowledgeBaseTableNames(id);
  const record: KnowledgeBaseRecord = {
    kb_id: id,
    title: kb.title,
    description: kb.description,
    vector_dimensions: kb.getVectorDimensions(),
    document_table: tableNames.documentTable,
    chunk_table: tableNames.chunkTable,
    created_at: now,
    updated_at: now,
  };

  // Write to persistent repository first so a failure doesn't leave stale in-memory state
  const repo = getGlobalKnowledgeBaseRepository();
  await repo.addKnowledgeBase(record);

  // Only add to live map after successful persistence
  kbs.set(id, kb);
}

/**
 * Gets a knowledge base by ID from the global registry
 */
export function getKnowledgeBase(id: string): KnowledgeBase | undefined {
  return getGlobalKnowledgeBases().get(id);
}

/**
 * Resolves a knowledge base ID from the registry.
 * Used by the input resolver system.
 */
async function resolveKnowledgeBaseFromRegistry(
  id: string,
  format: string,
  registry: ServiceRegistry
): Promise<KnowledgeBase> {
  const kbs = registry.has(KNOWLEDGE_BASES)
    ? registry.get<Map<string, KnowledgeBase>>(KNOWLEDGE_BASES)
    : getGlobalKnowledgeBases();

  const kb = kbs.get(id);
  if (!kb) {
    throw new Error(`Knowledge base "${id}" not found in registry`);
  }
  return kb;
}

// Register the resolver for format: "knowledge-base"
registerInputResolver("knowledge-base", resolveKnowledgeBaseFromRegistry);

// Register the compactor — reverse map lookup by identity
registerInputCompactor("knowledge-base", (value, _format, registry) => {
  const kbs = registry.has(KNOWLEDGE_BASES)
    ? registry.get<Map<string, KnowledgeBase>>(KNOWLEDGE_BASES)
    : getGlobalKnowledgeBases();

  for (const [id, kb] of kbs) {
    if (kb === value) return id;
  }
  return undefined;
});
