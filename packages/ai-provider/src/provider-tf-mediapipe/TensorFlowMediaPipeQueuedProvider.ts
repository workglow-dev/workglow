/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { QueuedAiProvider, type AiProviderReactiveRunFn, type AiProviderRunFn } from "@workglow/ai";
import { TENSORFLOW_MEDIAPIPE, TFMP_DEFAULT_TASK_TYPES } from "./common/TFMP_Constants";
import type { TFMPModelConfig } from "./common/TFMP_ModelSchema";

/** Main-thread registration (inline or worker-backed); creates the default job queue. */
export class TensorFlowMediaPipeQueuedProvider extends QueuedAiProvider<TFMPModelConfig> {
  readonly name = TENSORFLOW_MEDIAPIPE;
  readonly isLocal = true;
  readonly supportsBrowser = true;

  readonly taskTypes: readonly string[] = TFMP_DEFAULT_TASK_TYPES;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, TFMPModelConfig>>,
    reactiveTasks?: Record<string, AiProviderReactiveRunFn<any, any, TFMPModelConfig>>
  ) {
    super(tasks, undefined, reactiveTasks);
  }
}
