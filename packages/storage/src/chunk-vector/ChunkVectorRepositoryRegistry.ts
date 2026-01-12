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
import { AnyChunkVectorRepository } from "./IChunkVectorRepository";

/**
 * Service token for the documenbt chunk vector repository registry
 * Maps repository IDs to IVectorChunkRepository instances
 */
export const DOCUMENT_CHUNK_VECTOR_REPOSITORIES = createServiceToken<
  Map<string, AnyChunkVectorRepository>
>("storage.document-node-vector.repositories");

// Register default factory if not already registered
if (!globalServiceRegistry.has(DOCUMENT_CHUNK_VECTOR_REPOSITORIES)) {
  globalServiceRegistry.register(
    DOCUMENT_CHUNK_VECTOR_REPOSITORIES,
    (): Map<string, AnyChunkVectorRepository> => new Map(),
    true
  );
}

/**
 * Gets the global document chunk vector repository registry
 * @returns Map of document chunk vector repository ID to instance
 */
export function getGlobalChunkVectorRepositories(): Map<string, AnyChunkVectorRepository> {
  return globalServiceRegistry.get(DOCUMENT_CHUNK_VECTOR_REPOSITORIES);
}

/**
 * Registers a vector repository globally by ID
 * @param id The unique identifier for this repository
 * @param repository The repository instance to register
 */
export function registerChunkVectorRepository(
  id: string,
  repository: AnyChunkVectorRepository
): void {
  const repos = getGlobalChunkVectorRepositories();
  repos.set(id, repository);
}

/**
 * Gets a document chunk vector repository by ID from the global registry
 * @param id The repository identifier
 * @returns The repository instance or undefined if not found
 */
export function getChunkVectorRepository(id: string): AnyChunkVectorRepository | undefined {
  return getGlobalChunkVectorRepositories().get(id);
}

/**
 * Resolves a repository ID to an IVectorChunkRepository from the registry.
 * Used by the input resolver system.
 */
async function resolveChunkVectorRepositoryFromRegistry(
  id: string,
  format: string,
  registry: ServiceRegistry
): Promise<AnyChunkVectorRepository> {
  const repos = registry.has(DOCUMENT_CHUNK_VECTOR_REPOSITORIES)
    ? registry.get<Map<string, AnyChunkVectorRepository>>(DOCUMENT_CHUNK_VECTOR_REPOSITORIES)
    : getGlobalChunkVectorRepositories();

  const repo = repos.get(id);
  if (!repo) {
    throw new Error(`Document chunk vector repository "${id}" not found in registry`);
  }
  return repo;
}

// Register the repository resolver for format: "repository:document-node-vector"
registerInputResolver("repository:document-node-vector", resolveChunkVectorRepositoryFromRegistry);
