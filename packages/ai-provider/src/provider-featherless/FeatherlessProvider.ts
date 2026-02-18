/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider, type AiProviderRunFn, type AiProviderStreamFn } from "@workglow/ai";
import { FEATHERLESS_AI } from "./common/Featherless_Constants";
import type { FeatherlessModelConfig } from "./common/Featherless_ModelSchema";

/**
 * AI provider for Featherless.ai (OpenAI-compatible).
 *
 * Supports text generation, text rewriting, and text summarization
 * via the Featherless.ai API using the `openai` SDK.
 *
 * Note: Embedding support is not available as Featherless does not support the /v1/embeddings endpoint.
 *
 * Task run functions are injected via the constructor so that the `openai` SDK
 * is only imported where actually needed (inline mode, worker server), not on
 * the main thread in worker mode.
 *
 * @example
 * ```typescript
 * // Worker mode (main thread) -- lightweight, no SDK import:
 * await new FeatherlessProvider().register({
 *   mode: "worker",
 *   worker: new Worker(new URL("./worker_featherless.ts", import.meta.url), { type: "module" }),
 * });
 *
 * // Inline mode -- caller provides the tasks:
 * import { FEATHERLESS_TASKS } from "@workglow/ai-provider/featherless";
 * await new FeatherlessProvider(FEATHERLESS_TASKS).register({ mode: "inline" });
 *
 * // Worker side -- caller provides the tasks:
 * import { FEATHERLESS_TASKS } from "@workglow/ai-provider/featherless";
 * new FeatherlessProvider(FEATHERLESS_TASKS).registerOnWorkerServer(workerServer);
 * ```
 */
export class FeatherlessProvider extends AiProvider<FeatherlessModelConfig> {
  readonly name = FEATHERLESS_AI;

  readonly taskTypes = [
    "TextGenerationTask",
    "TextRewriterTask",
    "TextSummaryTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, FeatherlessModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, FeatherlessModelConfig>>
  ) {
    super(tasks, streamTasks);
  }
}
