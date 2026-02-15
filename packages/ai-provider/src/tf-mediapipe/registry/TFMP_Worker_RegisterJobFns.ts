/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EmbeddingModelV3CallOptions, LanguageModelV3CallOptions } from "@ai-sdk/provider";
import {
  createServiceToken,
  globalServiceRegistry,
  parentPort,
  WORKER_SERVER,
} from "@workglow/util";
import {
  TFMP_Download,
  TFMP_ImageClassification,
  TFMP_ImageEmbedding,
  TFMP_ImageSegmentation,
  TFMP_ObjectDetection,
  TFMP_TextClassification,
  TFMP_TextEmbedding,
  TFMP_TextLanguageDetection,
  TFMP_Unload,
} from "../common/TFMP_JobRunFns";
import type { TFMPModelConfig } from "../common/TFMP_ModelSchema";
import { TFMP_EmbeddingModel, TFMP_LanguageModel } from "../model/TFMP_V3Models";

// Register the worker functions
export const TFMP_WORKER_JOBRUN = createServiceToken("worker.ai-provider.tfmp");

export const TFMP_WORKER_JOBRUN_REGISTER = globalServiceRegistry.register(
  TFMP_WORKER_JOBRUN,
  () => {
    const workerServer = globalServiceRegistry.get(WORKER_SERVER);
    workerServer.registerFunction("DownloadModelTask", TFMP_Download);
    workerServer.registerFunction("UnloadModelTask", TFMP_Unload);
    workerServer.registerFunction("TextEmbeddingTask", TFMP_TextEmbedding);
    workerServer.registerFunction("TextLanguageDetectionTask", TFMP_TextLanguageDetection);
    workerServer.registerFunction("TextClassificationTask", TFMP_TextClassification);
    workerServer.registerFunction("ImageSegmentationTask", TFMP_ImageSegmentation);
    workerServer.registerFunction("ImageEmbeddingTask", TFMP_ImageEmbedding);
    workerServer.registerFunction("ImageClassificationTask", TFMP_ImageClassification);
    workerServer.registerFunction("ObjectDetectionTask", TFMP_ObjectDetection);
    workerServer.registerFunction(
      "LanguageModelV3.doGenerate",
      async (
        modelConfig: TFMPModelConfig,
        options: LanguageModelV3CallOptions,
        _postProgress: unknown,
        signal: AbortSignal
      ) => {
        const model = new TFMP_LanguageModel(modelConfig);
        return await model.doGenerate({ ...options, abortSignal: signal });
      }
    );
    workerServer.registerFunction(
      "EmbeddingModelV3.doEmbed",
      async (
        modelConfig: TFMPModelConfig,
        options: EmbeddingModelV3CallOptions,
        _postProgress: unknown,
        signal: AbortSignal
      ) => {
        const model = new TFMP_EmbeddingModel(modelConfig);
        return await model.doEmbed({ ...options, abortSignal: signal });
      }
    );
    parentPort.postMessage({ type: "ready" });
    return workerServer;
  },
  true
);
