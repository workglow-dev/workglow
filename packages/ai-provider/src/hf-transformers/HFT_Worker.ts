/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, parentPort, WORKER_SERVER } from "@workglow/util";
import { HFT_REACTIVE_TASKS, HFT_STREAM_TASKS, HFT_TASKS } from "./common/HFT_JobRunFns";
import { HuggingFaceTransformersProvider } from "./HuggingFaceTransformersProvider";

export function HFT_WORKER_JOBRUN_REGISTER() {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new HuggingFaceTransformersProvider(
    HFT_TASKS,
    HFT_STREAM_TASKS,
    HFT_REACTIVE_TASKS
  ).registerOnWorkerServer(workerServer);
  parentPort.postMessage({ type: "ready" });
  console.log("HFT_WORKER_JOBRUN registered");
}
