/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { getLogger, globalServiceRegistry, WORKER_SERVER } from "@workglow/util";
import { TFMP_TASKS } from "./common/TFMP_JobRunFns";
import { TensorFlowMediaPipeProvider } from "./TensorFlowMediaPipeProvider";

export async function registerTensorFlowMediaPipeInline(
  options?: AiProviderRegisterOptions
): Promise<void> {
  await new TensorFlowMediaPipeProvider(TFMP_TASKS).register(options ?? {});
}

export async function registerTensorFlowMediaPipe(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  await new TensorFlowMediaPipeProvider().register(options);
}

export function registerTensorFlowMediaPipeWorker(): void {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new TensorFlowMediaPipeProvider(TFMP_TASKS).registerOnWorkerServer(workerServer);
  workerServer.sendReady();
  getLogger().info("TensorFlow MediaPipe worker job run functions registered");
}
