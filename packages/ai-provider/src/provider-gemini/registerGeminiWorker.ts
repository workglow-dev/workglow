/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger, globalServiceRegistry, WORKER_SERVER } from "@workglow/util/worker";
import {
  GEMINI_REACTIVE_TASKS,
  GEMINI_STREAM_TASKS,
  GEMINI_TASKS,
} from "./common/Gemini_JobRunFns";
import { GoogleGeminiProvider } from "./GoogleGeminiProvider";

export async function registerGeminiWorker(): Promise<void> {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new GoogleGeminiProvider(
    GEMINI_TASKS,
    GEMINI_STREAM_TASKS,
    GEMINI_REACTIVE_TASKS
  ).registerOnWorkerServer(workerServer);
  workerServer.sendReady();
  getLogger().info("Google Gemini worker job run functions registered");
}
