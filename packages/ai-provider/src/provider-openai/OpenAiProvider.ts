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
import { OPENAI } from "./common/OpenAI_Constants";
import type { OpenAiModelConfig } from "./common/OpenAI_ModelSchema";

/**
 * AI provider for OpenAI cloud models.
 *
 * Supports text generation, text embedding, text rewriting, and text summarization
 * via the OpenAI API using the `openai` SDK.
 *
 * Task run functions are injected via the constructor so that the `openai` SDK
 * is only imported where actually needed (inline mode, worker server), not on
 * the main thread in worker mode.
 *
 * @example
 * ```typescript
 * // Worker mode (main thread) -- lightweight, no SDK import:
 * await new OpenAiProvider().register({
 *   mode: "worker",
 *   worker: new Worker(new URL("./worker_openai.ts", import.meta.url), { type: "module" }),
 * });
 *
 * // Inline mode -- caller provides the tasks:
 * import { OPENAI_TASKS } from "@workglow/ai-provider/openai";
 * await new OpenAiProvider(OPENAI_TASKS).register({ mode: "inline" });
 *
 * // Worker side -- caller provides the tasks:
 * import { OPENAI_TASKS } from "@workglow/ai-provider/openai";
 * new OpenAiProvider(OPENAI_TASKS).registerOnWorkerServer(workerServer);
 * ```
 */
export class OpenAiProvider extends AiProvider<OpenAiModelConfig> {
  readonly name = OPENAI;

  readonly taskTypes = [
    "TextGenerationTask",
    "TextEmbeddingTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "CountTokensTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, OpenAiModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, OpenAiModelConfig>>,
    reactiveTasks?: Record<string, AiProviderReactiveRunFn<any, any, OpenAiModelConfig>>
  ) {
    super(tasks, streamTasks, reactiveTasks);
  }
}
