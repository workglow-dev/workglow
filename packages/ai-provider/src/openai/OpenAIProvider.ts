/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider, type AiProviderRunFn } from "@workglow/ai";
import { OPENAI } from "./common/OpenAI_Constants";
import type { OpenAIModelConfig } from "./common/OpenAI_ModelSchema";

/**
 * AI provider for OpenAI models (GPT-3.5, GPT-4, GPT-4 Turbo, o1, etc.).
 *
 * Supports text generation via OpenAI's Chat Completions API.
 * Automatically uses the correct token parameter (max_tokens vs max_completion_tokens)
 * based on the model being used.
 *
 * @example
 * ```typescript
 * // Inline mode:
 * import { OPENAI_TASKS } from "@workglow/ai-provider";
 * await new OpenAIProvider(OPENAI_TASKS).register({ mode: "inline" });
 * ```
 */
export class OpenAIProvider extends AiProvider<OpenAIModelConfig> {
  readonly name = OPENAI;

  readonly taskTypes = [
    "DownloadModelTask",
    "TextGenerationTask",
  ] as const;

  constructor(tasks?: Record<string, AiProviderRunFn<any, any, OpenAIModelConfig>>) {
    super(tasks);
  }
}
