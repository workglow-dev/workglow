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
import type { DocumentRepository } from "./DocumentRepository";

/**
 * Service token for the document repository registry
 * Maps repository IDs to DocumentRepository instances
 */
export const DOCUMENT_REPOSITORIES =
  createServiceToken<Map<string, DocumentRepository>>("document.repositories");

// Register default factory if not already registered
if (!globalServiceRegistry.has(DOCUMENT_REPOSITORIES)) {
  globalServiceRegistry.register(
    DOCUMENT_REPOSITORIES,
    (): Map<string, DocumentRepository> => new Map(),
    true
  );
}

/**
 * Gets the global document repository registry
 * @returns Map of document repository ID to instance
 */
export function getGlobalDocumentRepositories(): Map<string, DocumentRepository> {
  return globalServiceRegistry.get(DOCUMENT_REPOSITORIES);
}

/**
 * Registers a document repository globally by ID
 * @param id The unique identifier for this repository
 * @param repository The repository instance to register
 */
export function registerDocumentRepository(id: string, repository: DocumentRepository): void {
  const repos = getGlobalDocumentRepositories();
  repos.set(id, repository);
}

/**
 * Gets a document repository by ID from the global registry
 * @param id The repository identifier
 * @returns The repository instance or undefined if not found
 */
export function getDocumentRepository(id: string): DocumentRepository | undefined {
  return getGlobalDocumentRepositories().get(id);
}

/**
 * Resolves a repository ID to a DocumentRepository from the registry.
 * Used by the input resolver system.
 */
async function resolveDocumentRepositoryFromRegistry(
  id: string,
  format: string,
  registry: ServiceRegistry
): Promise<DocumentRepository> {
  const repos = registry.has(DOCUMENT_REPOSITORIES)
    ? registry.get<Map<string, DocumentRepository>>(DOCUMENT_REPOSITORIES)
    : getGlobalDocumentRepositories();

  const repo = repos.get(id);
  if (!repo) {
    throw new Error(`Document repository "${id}" not found in registry`);
  }
  return repo;
}

// Register the repository resolver for format: "repository:document"
registerInputResolver("repository:document", resolveDocumentRepositoryFromRegistry);
