/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, WORKER_SERVER } from "@workglow/util";
import { TFMP_TASKS } from "./common/TFMP_JobRunFns";
import { TensorFlowMediaPipeProvider } from "./TensorFlowMediaPipeProvider";

export function TFMP_WORKER_JOBRUN_REGISTER() {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new TensorFlowMediaPipeProvider(TFMP_TASKS).registerOnWorkerServer(workerServer);
  workerServer.sendReady();
  console.log("TFMP_WORKER_JOBRUN registered");
}
