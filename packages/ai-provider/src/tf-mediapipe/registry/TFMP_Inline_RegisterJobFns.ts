/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiJob, AiJobInput, getAiProviderRegistry, getModelInstanceFactory } from "@workglow/ai";
import { ConcurrencyLimiter, JobQueueClient, JobQueueServer } from "@workglow/job-queue";
import { InMemoryQueueStorage } from "@workglow/storage";
import { getTaskQueueRegistry, TaskInput, TaskOutput } from "@workglow/task-graph";
import { TENSORFLOW_MEDIAPIPE } from "../common/TFMP_Constants";
import {
  TFMP_Download,
  TFMP_FaceDetector,
  TFMP_FaceLandmarker,
  TFMP_GestureRecognizer,
  TFMP_HandLandmarker,
  TFMP_ImageClassification,
  TFMP_ImageEmbedding,
  TFMP_ImageSegmentation,
  TFMP_ObjectDetection,
  TFMP_PoseLandmarker,
  TFMP_TextClassification,
  TFMP_TextEmbedding,
  TFMP_TextLanguageDetection,
  TFMP_Unload,
} from "../common/TFMP_JobRunFns";
import type { TFMPModelConfig } from "../common/TFMP_ModelSchema";
import { TFMP_EmbeddingModel, TFMP_LanguageModel } from "../model/TFMP_V3Models";

/**
 * Registers the TensorFlow MediaPipe inline job functions for same-thread execution.
 * If no client is provided, creates a default in-memory queue and registers it.
 *
 * @param client - Optional existing JobQueueClient. If not provided, creates a default in-memory queue.
 */
export async function register_TFMP_InlineJobFns(
  client?: JobQueueClient<AiJobInput<TaskInput>, TaskOutput>
): Promise<void> {
  const aiProviderRegistry = getAiProviderRegistry();

  aiProviderRegistry.registerRunFn<any, any>(
    TENSORFLOW_MEDIAPIPE,
    "DownloadModelTask",
    TFMP_Download as any
  );
  aiProviderRegistry.registerRunFn<any, any>(
    TENSORFLOW_MEDIAPIPE,
    "UnloadModelTask",
    TFMP_Unload as any
  );
  aiProviderRegistry.registerRunFn<any, any>(
    TENSORFLOW_MEDIAPIPE,
    "TextEmbeddingTask",
    TFMP_TextEmbedding as any
  );
  aiProviderRegistry.registerRunFn<any, any>(
    TENSORFLOW_MEDIAPIPE,
    "TextLanguageDetectionTask",
    TFMP_TextLanguageDetection as any
  );
  aiProviderRegistry.registerRunFn<any, any>(
    TENSORFLOW_MEDIAPIPE,
    "TextClassificationTask",
    TFMP_TextClassification as any
  );
  aiProviderRegistry.registerRunFn<any, any>(
    TENSORFLOW_MEDIAPIPE,
    "ImageSegmentationTask",
    TFMP_ImageSegmentation as any
  );
  aiProviderRegistry.registerRunFn<any, any>(
    TENSORFLOW_MEDIAPIPE,
    "ImageEmbeddingTask",
    TFMP_ImageEmbedding as any
  );
  aiProviderRegistry.registerRunFn<any, any>(
    TENSORFLOW_MEDIAPIPE,
    "ImageClassificationTask",
    TFMP_ImageClassification as any
  );
  aiProviderRegistry.registerRunFn<any, any>(
    TENSORFLOW_MEDIAPIPE,
    "ObjectDetectionTask",
    TFMP_ObjectDetection as any
  );
  aiProviderRegistry.registerRunFn<any, any>(
    TENSORFLOW_MEDIAPIPE,
    "GestureRecognizerTask",
    TFMP_GestureRecognizer as any
  );
  aiProviderRegistry.registerRunFn<any, any>(
    TENSORFLOW_MEDIAPIPE,
    "HandLandmarkerTask",
    TFMP_HandLandmarker as any
  );
  aiProviderRegistry.registerRunFn<any, any>(
    TENSORFLOW_MEDIAPIPE,
    "FaceDetectorTask",
    TFMP_FaceDetector as any
  );
  aiProviderRegistry.registerRunFn<any, any>(
    TENSORFLOW_MEDIAPIPE,
    "FaceLandmarkerTask",
    TFMP_FaceLandmarker as any
  );
  aiProviderRegistry.registerRunFn<any, any>(
    TENSORFLOW_MEDIAPIPE,
    "PoseLandmarkerTask",
    TFMP_PoseLandmarker as any
  );

  const modelFactory = getModelInstanceFactory();
  modelFactory.registerLanguageModel(
    TENSORFLOW_MEDIAPIPE,
    (config) => new TFMP_LanguageModel(config as TFMPModelConfig)
  );
  modelFactory.registerEmbeddingModel(
    TENSORFLOW_MEDIAPIPE,
    (config) => new TFMP_EmbeddingModel(config as TFMPModelConfig)
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
