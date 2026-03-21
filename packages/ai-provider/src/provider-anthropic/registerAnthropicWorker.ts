/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger, globalServiceRegistry, WORKER_SERVER } from "@workglow/util/worker";
import {
  ANTHROPIC_REACTIVE_TASKS,
  ANTHROPIC_STREAM_TASKS,
  ANTHROPIC_TASKS,
} from "./common/Anthropic_JobRunFns";
import { AnthropicProvider } from "./AnthropicProvider";

export async function registerAnthropicWorker(): Promise<void> {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new AnthropicProvider(
    ANTHROPIC_TASKS,
    ANTHROPIC_STREAM_TASKS,
    ANTHROPIC_REACTIVE_TASKS
  ).registerOnWorkerServer(workerServer);
  workerServer.sendReady();
  getLogger().info("Anthropic worker job run functions registered");
}
