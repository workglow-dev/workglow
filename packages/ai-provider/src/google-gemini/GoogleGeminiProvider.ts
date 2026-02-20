/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AiProvider,
  type AiProviderReactiveRunFn,
  type AiProviderRunFn,
  type AiProviderStreamFn,
} from "@workglow/ai";
import { GOOGLE_GEMINI } from "./common/Gemini_Constants";
import type { GeminiModelConfig } from "./common/Gemini_ModelSchema";

/**
 * AI provider for Google Gemini cloud models.
 *
 * Supports text generation, text embedding, text rewriting, and text summarization
 * via the Google Generative AI API using the `@google/generative-ai` SDK.
 *
 * Task run functions are injected via the constructor so that the SDK
 * is only imported where actually needed (inline mode, worker server), not on
 * the main thread in worker mode.
 *
 * @example
 * ```typescript
 * // Worker mode (main thread) -- lightweight, no SDK import:
 * await new GoogleGeminiProvider().register({
 *   mode: "worker",
 *   worker: new Worker(new URL("./worker_gemini.ts", import.meta.url), { type: "module" }),
 * });
 *
 * // Inline mode -- caller provides the tasks:
 * import { GEMINI_TASKS } from "@workglow/ai-provider/google-gemini";
 * await new GoogleGeminiProvider(GEMINI_TASKS).register({ mode: "inline" });
 * ```
 */
export class GoogleGeminiProvider extends AiProvider<GeminiModelConfig> {
  readonly name = GOOGLE_GEMINI;

  readonly taskTypes = [
    "CountTokensTask",
    "TextGenerationTask",
    "TextEmbeddingTask",
    "TextRewriterTask",
    "TextSummaryTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, GeminiModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, GeminiModelConfig>>,
    reactiveTasks?: Record<string, AiProviderReactiveRunFn<any, any, GeminiModelConfig>>
  ) {
    super(tasks, streamTasks, reactiveTasks);
  }
}
