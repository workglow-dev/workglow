/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, parentPort, WORKER_SERVER } from "@workglow/util";
import { ANTHROPIC_TASKS } from "./common/Anthropic_JobRunFns";
import { AnthropicProvider } from "./AnthropicProvider";

export function ANTHROPIC_WORKER_JOBRUN_REGISTER() {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new AnthropicProvider(ANTHROPIC_TASKS).registerOnWorkerServer(workerServer);
  parentPort.postMessage({ type: "ready" });
  console.log("ANTHROPIC_WORKER_JOBRUN registered");
}
