/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { getLogger, globalServiceRegistry, WORKER_SERVER } from "@workglow/util";
import { HFI_STREAM_TASKS, HFI_TASKS } from "./common/HFI_JobRunFns";
import { HfInferenceProvider } from "./HfInferenceProvider";

export async function registerHfInferenceInline(
  options?: AiProviderRegisterOptions
): Promise<void> {
  await new HfInferenceProvider(HFI_TASKS, HFI_STREAM_TASKS).register(options ?? {});
}

export async function registerHfInference(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  await new HfInferenceProvider().register(options);
}

export function registerHfInferenceWorker(): void {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new HfInferenceProvider(HFI_TASKS, HFI_STREAM_TASKS).registerOnWorkerServer(workerServer);
  workerServer.sendReady();
  getLogger().info("Hugging Face Inference worker job run functions registered");
}
