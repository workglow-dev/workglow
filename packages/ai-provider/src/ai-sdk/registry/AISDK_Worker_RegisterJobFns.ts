/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  EmbeddingModelV3CallOptions,
  ImageModelV3CallOptions,
  LanguageModelV3CallOptions,
} from "@ai-sdk/provider";
import type { ModelConfig } from "@workglow/ai";
import { getModelInstanceFactory } from "@workglow/ai";
import {
  createServiceToken,
  globalServiceRegistry,
  parentPort,
  WORKER_SERVER,
} from "@workglow/util";
import { registerCloudProviderFactories } from "../AISDK_Factories";

export const AISDK_WORKER_JOBRUN = createServiceToken("worker.ai-provider.aisdk");

export const AISDK_WORKER_JOBRUN_REGISTER = globalServiceRegistry.register(
  AISDK_WORKER_JOBRUN,
  () => {
    const workerServer = globalServiceRegistry.get(WORKER_SERVER);

    registerCloudProviderFactories();
    const modelFactory = getModelInstanceFactory();

    workerServer.registerFunction(
      "LanguageModelV3.doGenerate",
      async (
        modelConfig: ModelConfig,
        options: LanguageModelV3CallOptions,
        _postProgress: any,
        signal: AbortSignal
      ) => {
        const model = modelFactory.getLanguageModel(modelConfig);
        return await model.doGenerate({ ...options, abortSignal: signal });
      }
    );

    workerServer.registerFunction(
      "EmbeddingModelV3.doEmbed",
      async (
        modelConfig: ModelConfig,
        options: EmbeddingModelV3CallOptions,
        _postProgress: any,
        signal: AbortSignal
      ) => {
        const model = modelFactory.getEmbeddingModel(modelConfig);
        return await model.doEmbed({ ...options, abortSignal: signal });
      }
    );

    workerServer.registerFunction(
      "ImageModelV3.doGenerate",
      async (
        modelConfig: ModelConfig,
        options: ImageModelV3CallOptions,
        _postProgress: any,
        signal: AbortSignal
      ) => {
        const model = modelFactory.getImageModel(modelConfig);
        return await model.doGenerate({ ...options, abortSignal: signal });
      }
    );

    parentPort.postMessage({ type: "ready" });
    return workerServer;
  },
  true
);
