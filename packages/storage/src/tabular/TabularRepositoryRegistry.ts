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
import type { ITabularRepository } from "./ITabularRepository";

/**
 * Service token for the tabular repository registry
 * Maps repository IDs to ITabularRepository instances
 */
export const TABULAR_REPOSITORIES = createServiceToken<
  Map<string, ITabularRepository<any, any, any, any, any>>
>("storage.tabular.repositories");

// Register default factory if not already registered
if (!globalServiceRegistry.has(TABULAR_REPOSITORIES)) {
  globalServiceRegistry.register(
    TABULAR_REPOSITORIES,
    (): Map<string, ITabularRepository<any, any, any, any, any>> => new Map(),
    true
  );
}

/**
 * Gets the global tabular repository registry
 * @returns Map of tabular repository ID to instance
 */
export function getGlobalTabularRepositories(): Map<
  string,
  ITabularRepository<any, any, any, any, any>
> {
  return globalServiceRegistry.get(TABULAR_REPOSITORIES);
}

/**
 * Registers a tabular repository globally by ID
 * @param id The unique identifier for this repository
 * @param repository The repository instance to register
 */
export function registerTabularRepository(
  id: string,
  repository: ITabularRepository<any, any, any, any, any>
): void {
  const repos = getGlobalTabularRepositories();
  repos.set(id, repository);
}

/**
 * Gets a tabular repository by ID from the global registry
 * @param id The repository identifier
 * @returns The repository instance or undefined if not found
 */
export function getTabularRepository(
  id: string
): ITabularRepository<any, any, any, any, any> | undefined {
  return getGlobalTabularRepositories().get(id);
}

/**
 * Resolves a repository ID to an instance from the registry.
 * Used by the input resolver system.
 */
function resolveRepositoryFromRegistry(
  id: string,
  format: string,
  registry: ServiceRegistry
): ITabularRepository<any, any, any, any, any> {
  const repoType = format.split(":")[1]; // "tabular", "vector", "document"

  if (repoType === "tabular") {
    const repos = registry.has(TABULAR_REPOSITORIES)
      ? registry.get(TABULAR_REPOSITORIES)
      : getGlobalTabularRepositories();
    const repo = repos.get(id);
    if (!repo) {
      throw new Error(`Tabular repository "${id}" not found in registry`);
    }
    return repo;
  }

  // Future: vector, document repositories
  throw new Error(`Unknown repository type: ${repoType}`);
}

// Register the repository resolver for format: "repository:*"
registerInputResolver("repository", resolveRepositoryFromRegistry);
