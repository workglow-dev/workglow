/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger, globalServiceRegistry, WORKER_SERVER } from "@workglow/util/worker";
import {
  OPENAI_REACTIVE_TASKS,
  OPENAI_STREAM_TASKS,
  OPENAI_TASKS,
} from "./common/OpenAI_JobRunFns.browser";
import { OpenAiProvider } from "./OpenAiProvider";

export async function registerOpenAiWorker(): Promise<void> {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new OpenAiProvider(
    OPENAI_TASKS,
    OPENAI_STREAM_TASKS,
    OPENAI_REACTIVE_TASKS
  ).registerOnWorkerServer(workerServer);
  workerServer.sendReady();
  getLogger().info("OpenAI worker job run functions registered");
}
