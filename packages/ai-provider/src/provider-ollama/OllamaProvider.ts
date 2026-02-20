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
import { OLLAMA } from "./common/Ollama_Constants";
import type { OllamaModelConfig } from "./common/Ollama_ModelSchema";

/**
 * AI provider for Ollama local LLM server.
 *
 * Supports text generation, text embedding, text rewriting, and text summarization
 * via the Ollama API using the `ollama` SDK.
 *
 * Ollama runs locally and does not require an API key -- only a `base_url`
 * (defaults to `http://localhost:11434`).
 *
 * Task run functions are injected via the constructor so that the `ollama` SDK
 * is only imported where actually needed (inline mode, worker server), not on
 * the main thread in worker mode.
 *
 * @example
 * ```typescript
 * // Worker mode (main thread) -- lightweight, no SDK import:
 * await new OllamaProvider().register({
 *   mode: "worker",
 *   worker: new Worker(new URL("./worker_ollama.ts", import.meta.url), { type: "module" }),
 * });
 *
 * // Inline mode -- caller provides the tasks:
 * import { OLLAMA_TASKS } from "@workglow/ai-provider/ollama";
 * await new OllamaProvider(OLLAMA_TASKS).register({ mode: "inline" });
 * ```
 */
export class OllamaProvider extends AiProvider<OllamaModelConfig> {
  readonly name = OLLAMA;

  readonly taskTypes = [
    "TextGenerationTask",
    "TextEmbeddingTask",
    "TextRewriterTask",
    "TextSummaryTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, OllamaModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, OllamaModelConfig>>,
    reactiveTasks?: Record<string, AiProviderReactiveRunFn<any, any, OllamaModelConfig>>
  ) {
    super(tasks, streamTasks, reactiveTasks);
  }
}
