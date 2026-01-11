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
import { AnyDocumentNodeVectorRepository } from "./IDocumentNodeVectorRepository";

/**
 * Service token for the documenbt chunk vector repository registry
 * Maps repository IDs to IVectorChunkRepository instances
 */
export const DOCUMENT_CHUNK_VECTOR_REPOSITORIES = createServiceToken<
  Map<string, AnyDocumentNodeVectorRepository>
>("storage.document-node-vector.repositories");

// Register default factory if not already registered
if (!globalServiceRegistry.has(DOCUMENT_CHUNK_VECTOR_REPOSITORIES)) {
  globalServiceRegistry.register(
    DOCUMENT_CHUNK_VECTOR_REPOSITORIES,
    (): Map<string, AnyDocumentNodeVectorRepository> => new Map(),
    true
  );
}

/**
 * Gets the global document chunk vector repository registry
 * @returns Map of document chunk vector repository ID to instance
 */
export function getGlobalDocumentNodeVectorRepositories(): Map<
  string,
  AnyDocumentNodeVectorRepository
> {
  return globalServiceRegistry.get(DOCUMENT_CHUNK_VECTOR_REPOSITORIES);
}

/**
 * Registers a vector repository globally by ID
 * @param id The unique identifier for this repository
 * @param repository The repository instance to register
 */
export function registerDocumentNodeVectorRepository(
  id: string,
  repository: AnyDocumentNodeVectorRepository
): void {
  const repos = getGlobalDocumentNodeVectorRepositories();
  repos.set(id, repository);
}

/**
 * Gets a document chunk vector repository by ID from the global registry
 * @param id The repository identifier
 * @returns The repository instance or undefined if not found
 */
export function getDocumentNodeVectorRepository(
  id: string
): AnyDocumentNodeVectorRepository | undefined {
  return getGlobalDocumentNodeVectorRepositories().get(id);
}

/**
 * Resolves a repository ID to an IVectorChunkRepository from the registry.
 * Used by the input resolver system.
 */
async function resolveDocumentNodeVectorRepositoryFromRegistry(
  id: string,
  format: string,
  registry: ServiceRegistry
): Promise<AnyDocumentNodeVectorRepository> {
  const repos = registry.has(DOCUMENT_CHUNK_VECTOR_REPOSITORIES)
    ? registry.get<Map<string, AnyDocumentNodeVectorRepository>>(DOCUMENT_CHUNK_VECTOR_REPOSITORIES)
    : getGlobalDocumentNodeVectorRepositories();

  const repo = repos.get(id);
  if (!repo) {
    throw new Error(`Document chunk vector repository "${id}" not found in registry`);
  }
  return repo;
}

// Register the repository resolver for format: "repository:document-node-vector"
registerInputResolver(
  "repository:document-node-vector",
  resolveDocumentNodeVectorRepositoryFromRegistry
);
