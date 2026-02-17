/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider, type AiProviderRunFn } from "@workglow/ai";
import { TENSORFLOW_MEDIAPIPE } from "./common/TFMP_Constants";
import type { TFMPModelConfig } from "./common/TFMP_ModelSchema";

/**
 * AI provider for TensorFlow MediaPipe models.
 *
 * Supports text, vision, and gesture recognition tasks via @mediapipe packages.
 *
 * Task run functions are injected via the constructor so that the heavy
 * `@mediapipe/*` libraries are only imported where actually needed
 * (inline mode, worker server), not on the main thread in worker mode.
 *
 * @example
 * ```typescript
 * // Worker mode (main thread) -- lightweight, no heavy imports:
 * await new TensorFlowMediaPipeProvider().register({
 *   mode: "worker",
 *   worker: new Worker(new URL("./worker_tfmp.ts", import.meta.url), { type: "module" }),
 * });
 *
 * // Inline mode -- caller provides the tasks:
 * import { TFMP_TASKS } from "@workglow/ai-provider/tf-mediapipe";
 * await new TensorFlowMediaPipeProvider(TFMP_TASKS).register({ mode: "inline" });
 *
 * // Worker side -- caller provides the tasks:
 * import { TFMP_TASKS } from "@workglow/ai-provider/tf-mediapipe";
 * new TensorFlowMediaPipeProvider(TFMP_TASKS).registerOnWorkerServer(workerServer);
 * ```
 */
export class TensorFlowMediaPipeProvider extends AiProvider<TFMPModelConfig> {
  readonly name = TENSORFLOW_MEDIAPIPE;

  readonly taskTypes = [
    "DownloadModelTask",
    "UnloadModelTask",
    "TextEmbeddingTask",
    "TextLanguageDetectionTask",
    "TextClassificationTask",
    "ImageSegmentationTask",
    "ImageEmbeddingTask",
    "ImageClassificationTask",
    "ObjectDetectionTask",
    "GestureRecognizerTask",
    "HandLandmarkerTask",
    "FaceDetectorTask",
    "FaceLandmarkerTask",
    "PoseLandmarkerTask",
  ] as const;

  constructor(tasks?: Record<string, AiProviderRunFn<any, any, TFMPModelConfig>>) {
    super(tasks);
  }
}
