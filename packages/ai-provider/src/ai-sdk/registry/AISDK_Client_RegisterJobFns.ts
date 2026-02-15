/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getModelInstanceFactory,
  WorkerEmbeddingModelProxy,
  WorkerImageModelProxy,
  WorkerLanguageModelProxy,
} from "@workglow/ai";
import { globalServiceRegistry, WORKER_MANAGER } from "@workglow/util";
import { AI_SDK_PROVIDER_IDS } from "../AISDK_Constants";
import { PROVIDER_CAPABILITIES } from "../AISDK_Factories";

/**
 * Registers AI SDK providers for worker execution.
 * A single worker is shared across all AI SDK providers.
 */
export async function register_AISDK_ClientJobFns(worker: Worker): Promise<void> {
  const workerManager = globalServiceRegistry.get(WORKER_MANAGER);
  const modelFactory = getModelInstanceFactory();

  for (const provider of AI_SDK_PROVIDER_IDS) {
    workerManager.registerWorker(provider, worker);
    const caps = PROVIDER_CAPABILITIES[provider];
    if (caps.languageModel) {
      modelFactory.registerLanguageModel(
        provider,
        (config) => new WorkerLanguageModelProxy(provider, config)
      );
    }
    if (caps.embeddingModel) {
      modelFactory.registerEmbeddingModel(
        provider,
        (config) => new WorkerEmbeddingModelProxy(provider, config)
      );
    }
    if (caps.imageModel) {
      modelFactory.registerImageModel(
        provider,
        (config) => new WorkerImageModelProxy(provider, config)
      );
    }
  }
}
