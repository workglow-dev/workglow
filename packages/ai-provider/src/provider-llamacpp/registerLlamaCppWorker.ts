/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger, globalServiceRegistry, WORKER_SERVER } from "@workglow/util";
import {
  LLAMACPP_REACTIVE_TASKS,
  LLAMACPP_STREAM_TASKS,
  LLAMACPP_TASKS,
} from "./common/LlamaCpp_JobRunFns";
import { LlamaCppProvider } from "./LlamaCppProvider";

export async function registerLlamaCppWorker(): Promise<void> {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new LlamaCppProvider(
    LLAMACPP_TASKS,
    LLAMACPP_STREAM_TASKS,
    LLAMACPP_REACTIVE_TASKS
  ).registerOnWorkerServer(workerServer);
  workerServer.sendReady();
  getLogger().info("LlamaCpp worker job run functions registered");
}
