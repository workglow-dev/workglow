/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider, type AiProviderRunFn, type AiProviderStreamFn } from "@workglow/ai";
import { HF_INFERENCE } from "./common/HFI_Constants";
import type { HfInferenceModelConfig } from "./common/HFI_ModelSchema";

/**
 * AI provider for Hugging Face Inference API.
 *
 * Supports text generation, text embedding, text rewriting, and text summarization
 * via the Hugging Face Inference API using the `@huggingface/inference` SDK.
 *
 * Task run functions are injected via the constructor so that the `@huggingface/inference` SDK
 * is only imported where actually needed (inline mode, worker server), not on
 * the main thread in worker mode.
 *
 * @example
 * ```typescript
 * // Worker mode (main thread) -- lightweight, no SDK import:
 * await new HfInferenceProvider().register({
 *   mode: "worker",
 *   worker: new Worker(new URL("./worker_hfi.ts", import.meta.url), { type: "module" }),
 * });
 *
 * // Inline mode -- caller provides the tasks:
 * import { HFI_TASKS } from "@workglow/ai-provider/hf-inference";
 * await new HfInferenceProvider(HFI_TASKS).register({ mode: "inline" });
 *
 * // Worker side -- caller provides the tasks:
 * import { HFI_TASKS } from "@workglow/ai-provider/hf-inference";
 * new HfInferenceProvider(HFI_TASKS).registerOnWorkerServer(workerServer);
 * ```
 */
export class HfInferenceProvider extends AiProvider<HfInferenceModelConfig> {
  readonly name = HF_INFERENCE;

  readonly taskTypes = [
    "TextGenerationTask",
    "TextEmbeddingTask",
    "TextRewriterTask",
    "TextSummaryTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, HfInferenceModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, HfInferenceModelConfig>>
  ) {
    super(tasks, streamTasks);
  }
}
