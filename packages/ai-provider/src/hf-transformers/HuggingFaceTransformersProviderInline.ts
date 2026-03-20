/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderReactiveRunFn,
  AiProviderRegisterContext,
  AiProviderRunFn,
  AiProviderStreamFn,
} from "@workglow/ai";
import {
  clearHftInlinePipelineCache,
  initHftInlineOnnxWasmProxy,
} from "./common/HFT_InlineLifecycle";
import { HFT_REACTIVE_TASKS, HFT_STREAM_TASKS, HFT_TASKS } from "./common/HFT_JobRunFns";
import type { HfTransformersOnnxModelConfig } from "./common/HFT_ModelSchema";
import { HuggingFaceTransformersProvider } from "./HuggingFaceTransformersProvider";

/**
 * HuggingFace Transformers provider for **inline** execution on the main thread (or any thread
 * that runs inline `register()`). Configures ONNX WASM proxy and clears pipeline
 * cache on dispose.
 *
 * Package-internal: use `registerHuggingFaceTransformersInline` from this subpath for the public API.
 */
export class HuggingFaceTransformersProviderInline extends HuggingFaceTransformersProvider {
  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, HfTransformersOnnxModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, HfTransformersOnnxModelConfig>>,
    reactiveTasks?: Record<string, AiProviderReactiveRunFn<any, any, HfTransformersOnnxModelConfig>>
  ) {
    super(tasks ?? HFT_TASKS, streamTasks ?? HFT_STREAM_TASKS, reactiveTasks ?? HFT_REACTIVE_TASKS);
  }

  protected override async onInitialize(options: AiProviderRegisterContext): Promise<void> {
    if (options.isInline) {
      await initHftInlineOnnxWasmProxy();
    }
  }

  override async dispose(): Promise<void> {
    if (this.tasks) {
      await clearHftInlinePipelineCache();
    }
  }
}
