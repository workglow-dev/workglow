/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, parentPort, WORKER_SERVER } from "@workglow/util";
import { OLLAMA_TASKS } from "./common/Ollama_JobRunFns";
import { OllamaProvider } from "./OllamaProvider";

export function OLLAMA_WORKER_JOBRUN_REGISTER() {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new OllamaProvider(OLLAMA_TASKS).registerOnWorkerServer(workerServer);
  parentPort.postMessage({ type: "ready" });
  console.log("OLLAMA_WORKER_JOBRUN registered");
}
