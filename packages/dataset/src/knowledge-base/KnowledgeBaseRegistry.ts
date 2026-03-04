/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createServiceToken,
  globalServiceRegistry,
  registerInputResolver,
  ServiceRegistry,
} from "@workglow/util";
import type { KnowledgeBase } from "./KnowledgeBase";

/**
 * Service token for the knowledge base registry
 * Maps knowledge base IDs to KnowledgeBase instances
 */
export const KNOWLEDGE_BASES =
  createServiceToken<Map<string, KnowledgeBase>>("dataset.knowledge-bases");

// Register default factory if not already registered
if (!globalServiceRegistry.has(KNOWLEDGE_BASES)) {
  globalServiceRegistry.register(
    KNOWLEDGE_BASES,
    (): Map<string, KnowledgeBase> => new Map(),
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
 * Registers a knowledge base globally by ID
 */
export function registerKnowledgeBase(id: string, kb: KnowledgeBase): void {
  const kbs = getGlobalKnowledgeBases();
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

// Register the resolver for format: "dataset:knowledge-base"
registerInputResolver("dataset:knowledge-base", resolveKnowledgeBaseFromRegistry);
