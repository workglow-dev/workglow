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
import { OPENAI } from "./common/OpenAI_Constants";
import type { OpenAiModelConfig } from "./common/OpenAI_ModelSchema";

/** Main-thread registration (inline or worker-backed); creates the default job queue. */
export class OpenAiQueuedProvider extends QueuedAiProvider<OpenAiModelConfig> {
  readonly name = OPENAI;
  readonly isLocal = false;
  readonly supportsBrowser = true;

  readonly taskTypes = [
    "TextGenerationTask",
    "TextEmbeddingTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "CountTokensTask",
    "ModelInfoTask",
    "StructuredGenerationTask",
    "ToolCallingTask",
    "ModelSearchTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, OpenAiModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, OpenAiModelConfig>>,
    reactiveTasks?: Record<string, AiProviderReactiveRunFn<any, any, OpenAiModelConfig>>
  ) {
    super(tasks, streamTasks, reactiveTasks);
  }
}
