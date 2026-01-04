/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, globalServiceRegistry } from "./ServiceRegistry";
import type { ServiceRegistry } from "./ServiceRegistry";

/**
 * A resolver function that converts a string ID to an instance.
 * Returns undefined if the resolver cannot handle this format.
 * Throws an error if the ID is not found.
 *
 * @param id The string ID to resolve
 * @param format The full format string (e.g., "model:TextEmbedding", "repository:tabular")
 * @param registry The service registry to use for lookups
 */
export type InputResolverFn = (
  id: string,
  format: string,
  registry: ServiceRegistry
) => unknown | Promise<unknown>;

/**
 * Service token for the input resolver registry.
 * Maps format prefixes to resolver functions.
 */
export const INPUT_RESOLVERS = createServiceToken<Map<string, InputResolverFn>>(
  "task.input.resolvers"
);

// Register default factory if not already registered
if (!globalServiceRegistry.has(INPUT_RESOLVERS)) {
  globalServiceRegistry.register(
    INPUT_RESOLVERS,
    (): Map<string, InputResolverFn> => new Map(),
    true
  );
}

/**
 * Gets the global input resolver registry
 * @returns Map of format prefix to resolver function
 */
export function getInputResolvers(): Map<string, InputResolverFn> {
  return globalServiceRegistry.get(INPUT_RESOLVERS);
}

/**
 * Registers an input resolver for a format prefix.
 * The resolver will be called for any format that starts with this prefix.
 *
 * @param formatPrefix The format prefix to match (e.g., "model", "repository")
 * @param resolver The resolver function
 *
 * @example
 * ```typescript
 * // Register model resolver
 * registerInputResolver("model", async (id, format, registry) => {
 *   const modelRepo = registry.get(MODEL_REPOSITORY);
 *   const model = await modelRepo.findByName(id);
 *   if (!model) throw new Error(`Model "${id}" not found`);
 *   return model;
 * });
 *
 * // Register repository resolver
 * registerInputResolver("repository", (id, format, registry) => {
 *   const repoType = format.split(":")[1]; // "tabular", "vector", etc.
 *   if (repoType === "tabular") {
 *     const repos = registry.get(TABULAR_REPOSITORIES);
 *     const repo = repos.get(id);
 *     if (!repo) throw new Error(`Repository "${id}" not found`);
 *     return repo;
 *   }
 *   throw new Error(`Unknown repository type: ${repoType}`);
 * });
 * ```
 */
export function registerInputResolver(formatPrefix: string, resolver: InputResolverFn): void {
  const resolvers = getInputResolvers();
  resolvers.set(formatPrefix, resolver);
}
