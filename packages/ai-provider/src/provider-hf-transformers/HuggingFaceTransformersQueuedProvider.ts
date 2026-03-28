/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  QueuedAiProvider,
  DirectExecutionStrategy,
  type IAiExecutionStrategy,
  type AiProviderReactiveRunFn,
  type AiProviderRunFn,
  type AiProviderStreamFn,
} from "@workglow/ai";
import type { ModelConfig } from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "./common/HFT_Constants";
import type { HfTransformersOnnxModelConfig } from "./common/HFT_ModelSchema";

const GPU_DEVICES = new Set(["webgpu", "gpu", "metal"]);

/**
 * Main-thread registration (inline or worker-backed).
 * WebGPU/GPU/Metal models use a shared queue (concurrency=1) for GPU serialization.
 * WASM/CPU models execute directly without a queue.
 */
export class HuggingFaceTransformersQueuedProvider extends QueuedAiProvider<HfTransformersOnnxModelConfig> {
  readonly name = HF_TRANSFORMERS_ONNX;
  readonly displayName = "Hugging Face Transformers (ONNX)";
  readonly isLocal = true;
  readonly supportsBrowser = true;

  private directStrategy = new DirectExecutionStrategy();

  readonly taskTypes = [
    "DownloadModelTask",
    "UnloadModelTask",
    "ModelInfoTask",
    "CountTokensTask",
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
    "ToolCallingTask",
    "ModelSearchTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, HfTransformersOnnxModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, HfTransformersOnnxModelConfig>>,
    reactiveTasks?: Record<string, AiProviderReactiveRunFn<any, any, HfTransformersOnnxModelConfig>>
  ) {
    super(tasks, streamTasks, reactiveTasks);
  }

  protected override getStrategyForModel(model: ModelConfig): IAiExecutionStrategy {
    const device = (model as HfTransformersOnnxModelConfig).provider_config?.device;
    if (device && GPU_DEVICES.has(device)) {
      return this.queuedStrategy!;
    }
    return this.directStrategy;
  }
}
