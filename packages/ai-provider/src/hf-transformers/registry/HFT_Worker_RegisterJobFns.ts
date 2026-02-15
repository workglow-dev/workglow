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
import {
  createServiceToken,
  globalServiceRegistry,
  parentPort,
  WORKER_SERVER,
} from "@workglow/util";
import {
  HFT_BackgroundRemoval,
  HFT_Download,
  HFT_ImageClassification,
  HFT_ImageEmbedding,
  HFT_ImageSegmentation,
  HFT_ImageToText,
  HFT_ObjectDetection,
  HFT_TextClassification,
  HFT_TextEmbedding,
  HFT_TextFillMask,
  HFT_TextGeneration,
  HFT_TextLanguageDetection,
  HFT_TextNamedEntityRecognition,
  HFT_TextQuestionAnswer,
  HFT_TextRewriter,
  HFT_TextSummary,
  HFT_TextTranslation,
  HFT_Unload,
} from "../common/HFT_JobRunFns";
import type { HfTransformersOnnxModelConfig } from "../common/HFT_ModelSchema";
import { HFT_EmbeddingModel, HFT_ImageModel, HFT_LanguageModel } from "../model/HFT_V3Models";

export const HFT_WORKER_JOBRUN = createServiceToken("worker.ai-provider.hft");

export const HFT_WORKER_JOBRUN_REGISTER = globalServiceRegistry.register(
  HFT_WORKER_JOBRUN,
  () => {
    const workerServer = globalServiceRegistry.get(WORKER_SERVER);
    workerServer.registerFunction("DownloadModelTask", HFT_Download);
    workerServer.registerFunction("UnloadModelTask", HFT_Unload);
    workerServer.registerFunction("TextEmbeddingTask", HFT_TextEmbedding);
    workerServer.registerFunction("TextGenerationTask", HFT_TextGeneration);
    workerServer.registerFunction("TextLanguageDetectionTask", HFT_TextLanguageDetection);
    workerServer.registerFunction("TextClassificationTask", HFT_TextClassification);
    workerServer.registerFunction("TextFillMaskTask", HFT_TextFillMask);
    workerServer.registerFunction("TextNamedEntityRecognitionTask", HFT_TextNamedEntityRecognition);
    workerServer.registerFunction("TextTranslationTask", HFT_TextTranslation);
    workerServer.registerFunction("TextRewriterTask", HFT_TextRewriter);
    workerServer.registerFunction("TextSummaryTask", HFT_TextSummary);
    workerServer.registerFunction("TextQuestionAnswerTask", HFT_TextQuestionAnswer);
    workerServer.registerFunction("ImageSegmentationTask", HFT_ImageSegmentation);
    workerServer.registerFunction("ImageToTextTask", HFT_ImageToText);
    workerServer.registerFunction("BackgroundRemovalTask", HFT_BackgroundRemoval);
    workerServer.registerFunction("ImageEmbeddingTask", HFT_ImageEmbedding);
    workerServer.registerFunction("ImageClassificationTask", HFT_ImageClassification);
    workerServer.registerFunction("ObjectDetectionTask", HFT_ObjectDetection);
    workerServer.registerFunction(
      "LanguageModelV3.doGenerate",
      async (
        modelConfig: HfTransformersOnnxModelConfig,
        options: LanguageModelV3CallOptions,
        _postProgress: unknown,
        signal: AbortSignal
      ) => {
        const model = new HFT_LanguageModel(modelConfig);
        return await model.doGenerate({ ...options, abortSignal: signal });
      }
    );
    workerServer.registerFunction(
      "EmbeddingModelV3.doEmbed",
      async (
        modelConfig: HfTransformersOnnxModelConfig,
        options: EmbeddingModelV3CallOptions,
        _postProgress: unknown,
        signal: AbortSignal
      ) => {
        const model = new HFT_EmbeddingModel(modelConfig);
        return await model.doEmbed({ ...options, abortSignal: signal });
      }
    );
    workerServer.registerFunction(
      "ImageModelV3.doGenerate",
      async (
        modelConfig: HfTransformersOnnxModelConfig,
        options: ImageModelV3CallOptions,
        _postProgress: unknown,
        signal: AbortSignal
      ) => {
        const model = new HFT_ImageModel(modelConfig);
        return await model.doGenerate({ ...options, abortSignal: signal });
      }
    );
    parentPort.postMessage({ type: "ready" });
    return workerServer;
  },
  true
);
