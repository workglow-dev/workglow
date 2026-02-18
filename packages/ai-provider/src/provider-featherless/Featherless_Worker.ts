/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, parentPort, WORKER_SERVER } from "@workglow/util";
import { FEATHERLESS_STREAM_TASKS, FEATHERLESS_TASKS } from "./common/Featherless_JobRunFns";
import { FeatherlessProvider } from "./FeatherlessProvider";

export function FEATHERLESS_WORKER_JOBRUN_REGISTER() {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new FeatherlessProvider(FEATHERLESS_TASKS, FEATHERLESS_STREAM_TASKS).registerOnWorkerServer(
    workerServer
  );
  parentPort.postMessage({ type: "ready" });
  console.log("FEATHERLESS_WORKER_JOBRUN registered");
}
