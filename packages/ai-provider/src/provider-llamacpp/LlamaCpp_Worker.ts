/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, parentPort, WORKER_SERVER } from "@workglow/util";
import { LLAMACPP_STREAM_TASKS, LLAMACPP_TASKS } from "./common/LlamaCpp_JobRunFns";
import { LlamaCppProvider } from "./LlamaCppProvider";

export function LLAMACPP_WORKER_JOBRUN_REGISTER() {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new LlamaCppProvider(LLAMACPP_TASKS, LLAMACPP_STREAM_TASKS).registerOnWorkerServer(workerServer);
  parentPort.postMessage({ type: "ready" });
  console.log("LLAMACPP_WORKER_JOBRUN registered");
}
