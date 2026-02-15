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
  WorkerLanguageModelProxy,
} from "@workglow/ai";
import { ConcurrencyLimiter, JobQueueClient, JobQueueServer } from "@workglow/job-queue";
import { InMemoryQueueStorage } from "@workglow/storage";
import { getTaskQueueRegistry, TaskInput, TaskOutput } from "@workglow/task-graph";
import { globalServiceRegistry, WORKER_MANAGER } from "@workglow/util";
import { TENSORFLOW_MEDIAPIPE } from "../common/TFMP_Constants";

/**
 * Registers the TensorFlow MediaPipe client job functions with a web worker.
 * If no client is provided, creates a default in-memory queue and registers it.
 *
 * @param worker - The web worker to use for job execution
 * @param client - Optional existing JobQueueClient. If not provided, creates a default in-memory queue.
 */
export async function register_TFMP_ClientJobFns(
  worker: Worker,
  client?: JobQueueClient<AiJobInput<TaskInput>, TaskOutput>
): Promise<void> {
  const workerManager = globalServiceRegistry.get(WORKER_MANAGER);
  workerManager.registerWorker(TENSORFLOW_MEDIAPIPE, worker);

  const aiProviderRegistry = getAiProviderRegistry();
  const names = [
    "DownloadModelTask",
    "UnloadModelTask",
    "TextEmbeddingTask",
    "TextLanguageDetectionTask",
    "TextClassificationTask",
    "ImageSegmentationTask",
    "ImageEmbeddingTask",
    "ImageClassificationTask",
    "ObjectDetectionTask",
  ];
  for (const name of names) {
    aiProviderRegistry.registerAsWorkerRunFn(TENSORFLOW_MEDIAPIPE, name);
  }

  const modelFactory = getModelInstanceFactory();
  modelFactory.registerLanguageModel(
    TENSORFLOW_MEDIAPIPE,
    (config) => new WorkerLanguageModelProxy(TENSORFLOW_MEDIAPIPE, config)
  );
  modelFactory.registerEmbeddingModel(
    TENSORFLOW_MEDIAPIPE,
    (config) => new WorkerEmbeddingModelProxy(TENSORFLOW_MEDIAPIPE, config)
  );

  // If no client provided, create a default in-memory queue
  if (!client) {
    const storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(
      TENSORFLOW_MEDIAPIPE
    );
    await storage.setupDatabase();

    const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(AiJob, {
      storage,
      queueName: TENSORFLOW_MEDIAPIPE,
      limiter: new ConcurrencyLimiter(1, 100),
    });

    client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
      storage,
      queueName: TENSORFLOW_MEDIAPIPE,
    });

    client.attach(server);

    getTaskQueueRegistry().registerQueue({ server, client, storage });
    await server.start();
  }
}
