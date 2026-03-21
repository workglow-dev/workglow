/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger, globalServiceRegistry, WORKER_SERVER } from "@workglow/util/worker";
import { HFI_STREAM_TASKS, HFI_TASKS } from "./common/HFI_JobRunFns";
import { HfInferenceProvider } from "./HfInferenceProvider";

export async function registerHfInferenceWorker(): Promise<void> {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new HfInferenceProvider(HFI_TASKS, HFI_STREAM_TASKS).registerOnWorkerServer(workerServer);
  workerServer.sendReady();
  getLogger().info("Hugging Face Inference worker job run functions registered");
}
