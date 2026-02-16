/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AiProvider,
  type AiProviderRegisterOptions,
  type AiProviderRunFn,
  type AiProviderStreamFn,
} from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "./common/HFT_Constants";
import type { HfTransformersOnnxModelConfig } from "./common/HFT_ModelSchema";

/**
 * AI provider for HuggingFace Transformers ONNX models.
 *
 * Supports text, vision, and multimodal tasks via the @sroussey/transformers library.
 *
 * Task run functions are injected via the constructor so that the heavy
 * `@sroussey/transformers` library is only imported where actually needed
 * (inline mode, worker server), not on the main thread in worker mode.
 *
 * @example
 * ```typescript
 * // Worker mode (main thread) -- lightweight, no heavy imports:
 * await new HuggingFaceTransformersProvider().register({
 *   mode: "worker",
 *   worker: new Worker(new URL("./worker_hft.ts", import.meta.url), { type: "module" }),
 * });
 *
 * // Inline mode -- caller provides the tasks:
 * import { HFT_TASKS } from "@workglow/ai-provider";
 * await new HuggingFaceTransformersProvider(HFT_TASKS).register({ mode: "inline" });
 *
 * // Worker side -- caller provides the tasks:
 * import { HFT_TASKS } from "@workglow/ai-provider";
 * new HuggingFaceTransformersProvider(HFT_TASKS).registerOnWorkerServer(workerServer);
 * ```
 */
export class HuggingFaceTransformersProvider extends AiProvider<HfTransformersOnnxModelConfig> {
  readonly name = HF_TRANSFORMERS_ONNX;

  readonly taskTypes = [
    "DownloadModelTask",
    "UnloadModelTask",
    "TextEmbeddingTask",
    "TextGenerationTask",
    "TextQuestionAnswerTask",
    "TextLanguageDetectionTask",
    "TextClassificationTask",
    "TextFillMaskTask",
    "TextNamedEntityRecognitionTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "TextTranslationTask",
    "ImageSegmentationTask",
    "ImageToTextTask",
    "BackgroundRemovalTask",
    "ImageEmbeddingTask",
    "ImageClassificationTask",
    "ObjectDetectionTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, HfTransformersOnnxModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, HfTransformersOnnxModelConfig>>
  ) {
    super(tasks, streamTasks);
  }

  protected override async onInitialize(options: AiProviderRegisterOptions): Promise<void> {
    if (options.mode === "inline") {
      const { env } = await import("@sroussey/transformers");
      // @ts-ignore -- backends.onnx.wasm.proxy is not fully typed
      env.backends.onnx.wasm.proxy = true;
    }
  }

  override async dispose(): Promise<void> {
    if (this.tasks) {
      const { clearPipelineCache } = await import("./common/HFT_JobRunFns");
      clearPipelineCache();
    }
  }
}
