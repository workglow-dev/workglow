/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { getLogger, globalServiceRegistry, WORKER_SERVER } from "@workglow/util";
import { HFT_REACTIVE_TASKS, HFT_STREAM_TASKS, HFT_TASKS } from "./common/HFT_JobRunFns";
import { HuggingFaceTransformersProvider } from "./HuggingFaceTransformersProvider";
import { HuggingFaceTransformersProviderInline } from "./HuggingFaceTransformersProviderInline";

/**
 * Register HuggingFace Transformers ONNX on the **main thread** with inline execution
 * (full `@huggingface/transformers` in this bundle).
 */
export async function registerHuggingFaceTransformersInline(
  options?: AiProviderRegisterOptions
): Promise<void> {
  await new HuggingFaceTransformersProviderInline().register(options ?? {});
}

/**
 * Register HuggingFace Transformers ONNX on the **main thread** with worker-backed execution
 * (lightweight proxy; heavy work in the worker).
 */
export async function registerHuggingFaceTransformers(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  await new HuggingFaceTransformersProvider().register(options);
}

/**
 * Call inside the HuggingFace Transformers **worker** script to register task run functions
 * and signal readiness to the host.
 */
export function registerHuggingFaceTransformersWorker(): void {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new HuggingFaceTransformersProvider(
    HFT_TASKS,
    HFT_STREAM_TASKS,
    HFT_REACTIVE_TASKS
  ).registerOnWorkerServer(workerServer);
  workerServer.sendReady();
  getLogger().info("HuggingFaceTransformers worker job run functions registered");
}
