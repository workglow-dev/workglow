/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider, type AiProviderRunFn, type AiProviderStreamFn } from "@workglow/ai";
import { LOCAL_LLAMACPP } from "./common/LlamaCpp_Constants";
import type { LlamaCppModelConfig } from "./common/LlamaCpp_ModelSchema";

/**
 * AI provider for running GGUF models locally via node-llama-cpp.
 *
 * Supports model downloading, unloading, text generation, text embedding,
 * text rewriting, and text summarization using llama.cpp under the hood.
 *
 * This provider is server-side only (Node.js/Bun) — it requires native binaries
 * and cannot run in the browser.
 *
 * Models are cached in memory after the first load. Use UnloadModelTask to
 * release memory when a model is no longer needed.
 *
 * @example
 * ```typescript
 * // Inline mode:
 * import { LLAMACPP_TASKS, LLAMACPP_STREAM_TASKS } from "@workglow/ai-provider/llamacpp";
 * await new LlamaCppProvider(LLAMACPP_TASKS, LLAMACPP_STREAM_TASKS).register({ mode: "inline" });
 *
 * // Worker mode (main thread) -- lightweight, no SDK import:
 * await new LlamaCppProvider().register({
 *   mode: "worker",
 *   worker: new Worker(new URL("./worker_llamacpp.ts", import.meta.url), { type: "module" }),
 * });
 * ```
 */
export class LlamaCppProvider extends AiProvider<LlamaCppModelConfig> {
  readonly name = LOCAL_LLAMACPP;

  readonly taskTypes = [
    "DownloadModelTask",
    "UnloadModelTask",
    "CountTokensTask",
    "TextGenerationTask",
    "TextEmbeddingTask",
    "TextRewriterTask",
    "TextSummaryTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, LlamaCppModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, LlamaCppModelConfig>>
  ) {
    super(tasks, streamTasks);
  }
}
