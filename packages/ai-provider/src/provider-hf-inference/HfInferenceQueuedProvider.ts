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
import { HF_INFERENCE } from "./common/HFI_Constants";
import type { HfInferenceModelConfig } from "./common/HFI_ModelSchema";

/** Main-thread registration (inline or worker-backed); creates the default job queue. */
export class HfInferenceQueuedProvider extends QueuedAiProvider<HfInferenceModelConfig> {
  readonly name = HF_INFERENCE;
  readonly isLocal = false;
  readonly supportsBrowser = true;

  readonly taskTypes = [
    "ModelInfoTask",
    "TextGenerationTask",
    "TextEmbeddingTask",
    "TextRewriterTask",
    "TextSummaryTask",
    "ToolCallingTask",
    "ModelSearchTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, HfInferenceModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, HfInferenceModelConfig>>,
    reactiveTasks?: Record<string, AiProviderReactiveRunFn<any, any, HfInferenceModelConfig>>
  ) {
    super(tasks, streamTasks, reactiveTasks);
  }
}
