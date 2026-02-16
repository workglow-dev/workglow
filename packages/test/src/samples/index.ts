/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  HFT_TASKS,
  HuggingFaceTransformersProvider,
  TFMP_TASKS,
  TensorFlowMediaPipeProvider,
} from "@workglow/ai-provider";
export * from "./MediaPipeModelSamples";
export * from "./ONNXModelSamples";

/**
 * Registers HuggingFace Transformers provider with inline execution and in-memory queue.
 * Equivalent to: `new HuggingFaceTransformersProvider(HFT_TASKS).register({ mode: "inline" })`
 */
export async function register_HFT_InMemoryQueue(): Promise<void> {
  await new HuggingFaceTransformersProvider(HFT_TASKS).register({ mode: "inline" });
}

/**
 * Registers TensorFlow MediaPipe provider with inline execution and in-memory queue.
 * Equivalent to: `new TensorFlowMediaPipeProvider(TFMP_TASKS).register({ mode: "inline" })`
 */
export async function register_TFMP_InMemoryQueue(): Promise<void> {
  await new TensorFlowMediaPipeProvider(TFMP_TASKS).register({ mode: "inline" });
}
