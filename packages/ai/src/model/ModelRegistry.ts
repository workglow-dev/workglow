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
import type { ModelConfig } from "./ModelSchema";
import { ModelRepository } from "./ModelRepository";

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
 * @param pr The model repository instance to register
 */
export function setGlobalModelRepository(pr: ModelRepository): void {
  globalServiceRegistry.registerInstance(MODEL_REPOSITORY, pr);
}

/**
 * Resolves a model ID to a ModelConfig from the repository.
 * Used by the input resolver system.
 */
async function resolveModelFromRegistry(
  id: string,
  format: string,
  registry: ServiceRegistry
): Promise<ModelConfig> {
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
