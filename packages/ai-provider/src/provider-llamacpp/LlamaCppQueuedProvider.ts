/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  QueuedAiProvider,
  type AiProviderReactiveRunFn,
  type AiProviderRunFn,
  type AiProviderStreamFn,
} from "@workglow/ai";
import { LOCAL_LLAMACPP } from "./common/LlamaCpp_Constants";
import type { LlamaCppModelConfig } from "./common/LlamaCpp_ModelSchema";

/** Main-thread registration (inline or worker-backed); creates the default job queue. */
export class LlamaCppQueuedProvider extends QueuedAiProvider<LlamaCppModelConfig> {
  readonly name = LOCAL_LLAMACPP;
  readonly isLocal = true;
  readonly supportsBrowser = false;

  readonly taskTypes = [
    "DownloadModelTask",
    "UnloadModelTask",
    "ModelInfoTask",
    "CountTokensTask",
    "TextGenerationTask",
    "TextEmbeddingTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "ToolCallingTask",
    "ModelSearchTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, LlamaCppModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, LlamaCppModelConfig>>,
    reactiveTasks?: Record<string, AiProviderReactiveRunFn<any, any, LlamaCppModelConfig>>
  ) {
    super(tasks, streamTasks, reactiveTasks);
  }
}
