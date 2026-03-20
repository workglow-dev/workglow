/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Inline-only lifecycle hooks for HuggingFace Transformers (ONNX WASM proxy, pipeline cache).
 * Kept in a dedicated module so apps that only use worker mode never load this file or
 * `@huggingface/transformers` / full `HFT_JobRunFns` barrel on the main thread.
 */
export async function initHftInlineOnnxWasmProxy(): Promise<void> {
  const { env } = await import("@huggingface/transformers");
  // @ts-ignore -- backends.onnx.wasm.proxy is not fully typed
  env.backends.onnx.wasm.proxy = true;
}

export async function clearHftInlinePipelineCache(): Promise<void> {
  const { clearPipelineCache } = await import("./HFT_Pipeline");
  clearPipelineCache();
}
