/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiProvider, type AiProviderReactiveRunFn, type AiProviderRunFn } from "@workglow/ai";
import { TENSORFLOW_MEDIAPIPE, TFMP_DEFAULT_TASK_TYPES } from "./common/TFMP_Constants";
import type { TFMPModelConfig } from "./common/TFMP_ModelSchema";

/**
 * AI provider for TensorFlow MediaPipe models.
 *
 * Task run functions are injected via the constructor so that the heavy
 * `@mediapipe/*` libraries are only imported where actually needed
 * (inline mode, worker server), not on the main thread in worker mode.
 *
 * @example
 * ```typescript
 * import { registerTensorFlowMediaPipe } from "@workglow/ai-provider/tf-mediapipe";
 * await registerTensorFlowMediaPipe({
 *   worker: () => new Worker(new URL("./worker_tfmp.ts", import.meta.url), { type: "module" }),
 * });
 * ```
 */
export class TensorFlowMediaPipeProvider extends AiProvider<TFMPModelConfig> {
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
