/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, parentPort, WORKER_SERVER } from "@workglow/util";
import { HFI_STREAM_TASKS, HFI_TASKS } from "./common/HFI_JobRunFns";
import { HfInferenceProvider } from "./HfInferenceProvider";

export function HFI_WORKER_JOBRUN_REGISTER() {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new HfInferenceProvider(HFI_TASKS, HFI_STREAM_TASKS).registerOnWorkerServer(workerServer);
  parentPort.postMessage({ type: "ready" });
  console.log("HFI_WORKER_JOBRUN registered");
}
