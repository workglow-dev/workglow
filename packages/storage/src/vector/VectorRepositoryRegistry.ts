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
import type { IVectorRepository } from "./IVectorRepository";

/**
 * Service token for the vector repository registry
 * Maps repository IDs to IVectorRepository instances
 */
export const VECTOR_REPOSITORIES = createServiceToken<Map<string, IVectorRepository<any>>>(
  "vector.repositories"
);

// Register default factory if not already registered
if (!globalServiceRegistry.has(VECTOR_REPOSITORIES)) {
  globalServiceRegistry.register(
    VECTOR_REPOSITORIES,
    (): Map<string, IVectorRepository<any>> => new Map(),
    true
  );
}

/**
 * Gets the global vector repository registry
 * @returns Map of vector repository ID to instance
 */
export function getGlobalVectorRepositories(): Map<string, IVectorRepository<any>> {
  return globalServiceRegistry.get(VECTOR_REPOSITORIES);
}

/**
 * Registers a vector repository globally by ID
 * @param id The unique identifier for this repository
 * @param repository The repository instance to register
 */
export function registerVectorRepository(id: string, repository: IVectorRepository<any>): void {
  const repos = getGlobalVectorRepositories();
  repos.set(id, repository);
}

/**
 * Gets a vector repository by ID from the global registry
 * @param id The repository identifier
 * @returns The repository instance or undefined if not found
 */
export function getVectorRepository(id: string): IVectorRepository<any> | undefined {
  return getGlobalVectorRepositories().get(id);
}

/**
 * Resolves a repository ID to an IVectorRepository from the registry.
 * Used by the input resolver system.
 */
async function resolveVectorRepositoryFromRegistry(
  id: string,
  format: string,
  registry: ServiceRegistry
): Promise<IVectorRepository<any>> {
  const repos = registry.has(VECTOR_REPOSITORIES)
    ? registry.get<Map<string, IVectorRepository<any>>>(VECTOR_REPOSITORIES)
    : getGlobalVectorRepositories();

  const repo = repos.get(id);
  if (!repo) {
    throw new Error(`Vector repository "${id}" not found in registry`);
  }
  return repo;
}

// Register the repository resolver for format: "repository:vector"
registerInputResolver("repository:vector", resolveVectorRepositoryFromRegistry);
