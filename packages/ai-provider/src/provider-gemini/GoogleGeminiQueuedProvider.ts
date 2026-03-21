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
import { GOOGLE_GEMINI } from "./common/Gemini_Constants";
import type { GeminiModelConfig } from "./common/Gemini_ModelSchema";

/** Main-thread registration (inline or worker-backed); creates the default job queue. */
export class GoogleGeminiQueuedProvider extends QueuedAiProvider<GeminiModelConfig> {
  readonly name = GOOGLE_GEMINI;
  readonly isLocal = false;
  readonly supportsBrowser = true;

  readonly taskTypes = [
    "CountTokensTask",
    "ModelInfoTask",
    "TextGenerationTask",
    "TextEmbeddingTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "StructuredGenerationTask",
    "ToolCallingTask",
    "ModelSearchTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, GeminiModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, GeminiModelConfig>>,
    reactiveTasks?: Record<string, AiProviderReactiveRunFn<any, any, GeminiModelConfig>>
  ) {
    super(tasks, streamTasks, reactiveTasks);
  }
}
