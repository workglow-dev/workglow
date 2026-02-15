/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AiJob,
  AiJobInput,
  getAiProviderRegistry,
  getModelInstanceFactory,
  WorkerEmbeddingModelProxy,
  WorkerImageModelProxy,
  WorkerLanguageModelProxy,
} from "@workglow/ai";
import { ConcurrencyLimiter, JobQueueClient, JobQueueServer } from "@workglow/job-queue";
import { InMemoryQueueStorage } from "@workglow/storage";
import { getTaskQueueRegistry, TaskInput, TaskOutput } from "@workglow/task-graph";
import { globalServiceRegistry, WORKER_MANAGER } from "@workglow/util";
import { HF_TRANSFORMERS_ONNX } from "../common/HFT_Constants";

/**
 * Registers the HuggingFace Transformers client job functions with a web worker.
 * If no client is provided, creates a default in-memory queue and registers it.
 *
 * @param worker - The web worker to use for job execution
 * @param client - Optional existing JobQueueClient. If not provided, creates a default in-memory queue.
 */
export async function register_HFT_ClientJobFns(
  worker: Worker,
  client?: JobQueueClient<AiJobInput<TaskInput>, TaskOutput>
): Promise<void> {
  const workerManager = globalServiceRegistry.get(WORKER_MANAGER);

  workerManager.registerWorker(HF_TRANSFORMERS_ONNX, worker);

  const ProviderRegistry = getAiProviderRegistry();
  const names = [
    "DownloadModelTask",
    "UnloadModelTask",
    "TextEmbeddingTask",
    "TextLanguageDetectionTask",
    "TextClassificationTask",
    "TextFillMaskTask",
    "TextNamedEntityRecognitionTask",
    "TextGenerationTask",
    "TextTranslationTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "TextQuestionAnswerTask",
    "ImageSegmentationTask",
    "ImageToTextTask",
    "BackgroundRemovalTask",
    "ImageEmbeddingTask",
    "ImageClassificationTask",
    "ObjectDetectionTask",
  ];
  for (const name of names) {
    ProviderRegistry.registerAsWorkerRunFn(HF_TRANSFORMERS_ONNX, name);
  }

  const modelFactory = getModelInstanceFactory();
  modelFactory.registerLanguageModel(
    HF_TRANSFORMERS_ONNX,
    (config) => new WorkerLanguageModelProxy(HF_TRANSFORMERS_ONNX, config)
  );
  modelFactory.registerEmbeddingModel(
    HF_TRANSFORMERS_ONNX,
    (config) => new WorkerEmbeddingModelProxy(HF_TRANSFORMERS_ONNX, config)
  );
  modelFactory.registerImageModel(
    HF_TRANSFORMERS_ONNX,
    (config) => new WorkerImageModelProxy(HF_TRANSFORMERS_ONNX, config)
  );
  // If no client provided, create a default in-memory queue
  if (!client) {
    const storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(
      HF_TRANSFORMERS_ONNX
    );

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
    // await server.start();
  }
}
