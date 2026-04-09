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
import { InMemoryModelRepository } from "./InMemoryModelRepository";
import { ModelRepository } from "./ModelRepository";
import type { ModelConfig } from "./ModelSchema";

/**
 * Service token for the global model repository
 */
export const MODEL_REPOSITORY = createServiceToken<ModelRepository>("model.repository");

// Register default factory if not already registered
globalServiceRegistry.registerIfAbsent(
  MODEL_REPOSITORY,
  (): ModelRepository => new InMemoryModelRepository(),
  true
);

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
): Promise<ModelConfig | undefined> {
  const modelRepo = registry.has(MODEL_REPOSITORY)
    ? registry.get<ModelRepository>(MODEL_REPOSITORY)
    : getGlobalModelRepository();

  const model = await modelRepo.findByName(id);
  if (!model) {
    throw new Error(`Model "${id}" not found in repository`);
  }
  return model;
}

// Register the model resolver for format: "model" and "model:*"
registerInputResolver("model", resolveModelFromRegistry);

// Register the model compactor — extracts model_id from a ModelConfig
registerInputCompactor("model", async (value, _format, registry) => {
  if (typeof value === "object" && value !== null && "model_id" in value) {
    const id = (value as Record<string, unknown>).model_id;
    if (typeof id !== "string") return undefined;
    const modelRepo = registry.has(MODEL_REPOSITORY)
      ? registry.get<ModelRepository>(MODEL_REPOSITORY)
      : getGlobalModelRepository();

    const model = await modelRepo.findByName(id);
    if (!model) return undefined;
    return id;
  }
  return undefined;
});
