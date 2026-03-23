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
import { ANTHROPIC } from "./common/Anthropic_Constants";
import type { AnthropicModelConfig } from "./common/Anthropic_ModelSchema";

/** Main-thread registration (inline or worker-backed); creates the default job queue. */
export class AnthropicQueuedProvider extends QueuedAiProvider<AnthropicModelConfig> {
  readonly name = ANTHROPIC;
  readonly displayName = "Anthropic";
  readonly isLocal = false;
  readonly supportsBrowser = true;

  readonly taskTypes = [
    "CountTokensTask",
    "ModelInfoTask",
    "TextGenerationTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "StructuredGenerationTask",
    "ToolCallingTask",
    "ModelSearchTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, AnthropicModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, AnthropicModelConfig>>,
    reactiveTasks?: Record<string, AiProviderReactiveRunFn<any, any, AnthropicModelConfig>>
  ) {
    super(tasks, streamTasks, reactiveTasks);
  }
}
