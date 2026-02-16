/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, parentPort, WORKER_SERVER } from "@workglow/util";
import { GEMINI_TASKS } from "./common/Gemini_JobRunFns";
import { GoogleGeminiProvider } from "./GoogleGeminiProvider";

export function GEMINI_WORKER_JOBRUN_REGISTER() {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new GoogleGeminiProvider(GEMINI_TASKS).registerOnWorkerServer(workerServer);
  parentPort.postMessage({ type: "ready" });
  console.log("GEMINI_WORKER_JOBRUN registered");
}
