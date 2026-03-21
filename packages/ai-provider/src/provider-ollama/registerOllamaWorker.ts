/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger, globalServiceRegistry, WORKER_SERVER } from "@workglow/util/worker";
import { OLLAMA_STREAM_TASKS, OLLAMA_TASKS } from "./common/Ollama_JobRunFns";
import { OllamaProvider } from "./OllamaProvider";

export async function registerOllamaWorker(): Promise<void> {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new OllamaProvider(OLLAMA_TASKS, OLLAMA_STREAM_TASKS).registerOnWorkerServer(workerServer);
  workerServer.sendReady();
  getLogger().info("Ollama worker job run functions registered");
}
