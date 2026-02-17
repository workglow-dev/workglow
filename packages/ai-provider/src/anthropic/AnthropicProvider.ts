/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider, type AiProviderRunFn, type AiProviderStreamFn } from "@workglow/ai";
import { ANTHROPIC } from "./common/Anthropic_Constants";
import type { AnthropicModelConfig } from "./common/Anthropic_ModelSchema";

/**
 * AI provider for Anthropic cloud models.
 *
 * Supports text generation, text rewriting, and text summarization via the
 * Anthropic Messages API using the `@anthropic-ai/sdk` SDK.
 *
 * Note: Anthropic does not offer an embeddings API, so TextEmbeddingTask
 * is not supported by this provider.
 *
 * Task run functions are injected via the constructor so that the SDK
 * is only imported where actually needed (inline mode, worker server), not on
 * the main thread in worker mode.
 *
 * @example
 * ```typescript
 * // Worker mode (main thread) -- lightweight, no SDK import:
 * await new AnthropicProvider().register({
 *   mode: "worker",
 *   worker: new Worker(new URL("./worker_anthropic.ts", import.meta.url), { type: "module" }),
 * });
 *
 * // Inline mode -- caller provides the tasks:
 * import { ANTHROPIC_TASKS } from "@workglow/ai-provider/anthropic";
 * await new AnthropicProvider(ANTHROPIC_TASKS).register({ mode: "inline" });
 * ```
 */
export class AnthropicProvider extends AiProvider<AnthropicModelConfig> {
  readonly name = ANTHROPIC;

  readonly taskTypes = ["TextGenerationTask", "TextRewriterTask", "TextSummaryTask"] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, AnthropicModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, AnthropicModelConfig>>
  ) {
    super(tasks, streamTasks);
  }
}
