/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { env } from "@sroussey/transformers";
import {
  AiJob,
  AiJobInput,
  AiProviderRunFn,
  getAiProviderRegistry,
  getModelInstanceFactory,
} from "@workglow/ai";
import { ConcurrencyLimiter, JobQueueClient, JobQueueServer } from "@workglow/job-queue";
import { InMemoryQueueStorage } from "@workglow/storage";
import { getTaskQueueRegistry, TaskInput, TaskOutput } from "@workglow/task-graph";
import { HF_TRANSFORMERS_ONNX } from "../common/HFT_Constants";
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

/**
 * Registers the HuggingFace Transformers inline job functions for same-thread execution.
 * If no client is provided, creates a default in-memory queue and registers it.
 *
 * @param client - Optional existing JobQueueClient. If not provided, creates a default in-memory queue.
 */
export async function register_HFT_InlineJobFns(
  client?: JobQueueClient<AiJobInput<TaskInput>, TaskOutput>
): Promise<void> {
  // @ts-ignore
  env.backends.onnx.wasm.proxy = true;
  const ProviderRegistry = getAiProviderRegistry();
  const fns: Record<string, AiProviderRunFn<any, any, any>> = {
    ["DownloadModelTask"]: HFT_Download,
    ["UnloadModelTask"]: HFT_Unload,
    ["TextEmbeddingTask"]: HFT_TextEmbedding,
    ["TextGenerationTask"]: HFT_TextGeneration,
    ["TextQuestionAnswerTask"]: HFT_TextQuestionAnswer,
    ["TextLanguageDetectionTask"]: HFT_TextLanguageDetection,
    ["TextClassificationTask"]: HFT_TextClassification,
    ["TextFillMaskTask"]: HFT_TextFillMask,
    ["TextNamedEntityRecognitionTask"]: HFT_TextNamedEntityRecognition,
    ["TextRewriterTask"]: HFT_TextRewriter,
    ["TextSummaryTask"]: HFT_TextSummary,
    ["TextTranslationTask"]: HFT_TextTranslation,
    ["ImageSegmentationTask"]: HFT_ImageSegmentation,
    ["ImageToTextTask"]: HFT_ImageToText,
    ["BackgroundRemovalTask"]: HFT_BackgroundRemoval,
    ["ImageEmbeddingTask"]: HFT_ImageEmbedding,
    ["ImageClassificationTask"]: HFT_ImageClassification,
    ["ObjectDetectionTask"]: HFT_ObjectDetection,
  };
  for (const [jobName, fn] of Object.entries(fns)) {
    ProviderRegistry.registerRunFn<any, any>(HF_TRANSFORMERS_ONNX, jobName, fn);
  }

  const modelFactory = getModelInstanceFactory();
  modelFactory.registerLanguageModel(
    HF_TRANSFORMERS_ONNX,
    (config) => new HFT_LanguageModel(config as HfTransformersOnnxModelConfig)
  );
  modelFactory.registerEmbeddingModel(
    HF_TRANSFORMERS_ONNX,
    (config) => new HFT_EmbeddingModel(config as HfTransformersOnnxModelConfig)
  );
  modelFactory.registerImageModel(
    HF_TRANSFORMERS_ONNX,
    (config) => new HFT_ImageModel(config as HfTransformersOnnxModelConfig)
  );

  // If no client provided, create a default in-memory queue
  if (!client) {
    const storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(
      HF_TRANSFORMERS_ONNX
    );
    await storage.setupDatabase();

    const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(AiJob, {
      storage,
      queueName: HF_TRANSFORMERS_ONNX,
      limiter: new ConcurrencyLimiter(1, 100),
    });

    client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
      storage,
      queueName: HF_TRANSFORMERS_ONNX,
    });

    client.attach(server);

    getTaskQueueRegistry().registerQueue({ server, client, storage });
    await server.start();
  }
}
