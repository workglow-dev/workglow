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
import { InMemoryModelRepository } from "./InMemoryModelRepository";
import { ModelRepository } from "./ModelRepository";
import type { ModelConfig } from "./ModelSchema";

/**
 * Service token for the global model repository
 */
export const MODEL_REPOSITORY = createServiceToken<ModelRepository>("model.repository");

// Register default factory if not already registered
if (!globalServiceRegistry.has(MODEL_REPOSITORY)) {
  globalServiceRegistry.register(
    MODEL_REPOSITORY,
    (): ModelRepository => new InMemoryModelRepository(),
    true
  );
}

/**
 * Gets the global model repository instance
 * @returns The model repository instance
 */
export function getGlobalModelRepository(): ModelRepository {
  return globalServiceRegistry.get(MODEL_REPOSITORY);
}

/**
 * Sets the global model repository instance
 * @param repository The model repository instance to register
 */
export function setGlobalModelRepository(repository: ModelRepository): void {
  globalServiceRegistry.registerInstance(MODEL_REPOSITORY, repository);
}

/**
 * Resolves a model ID to a ModelConfig from the repository.
 * Used by the input resolver system.
 */
async function resolveModelFromRegistry(
  id: string,
  format: string,
  registry: ServiceRegistry
): Promise<ModelConfig | ModelConfig[] | undefined> {
  const modelRepo = registry.has(MODEL_REPOSITORY)
    ? registry.get<ModelRepository>(MODEL_REPOSITORY)
    : getGlobalModelRepository();

  if (Array.isArray(id)) {
    const results = await Promise.all(id.map((i) => modelRepo.findByName(i)));
    return results.filter((model): model is NonNullable<typeof model> => model !== undefined);
  }

  const model = await modelRepo.findByName(id);
  if (!model) {
    throw new Error(`Model "${id}" not found in repository`);
  }
  return model;
}

// Register the model resolver for format: "model" and "model:*"
registerInputResolver("model", resolveModelFromRegistry);
