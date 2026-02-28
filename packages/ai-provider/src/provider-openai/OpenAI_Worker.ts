/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger, globalServiceRegistry, WORKER_SERVER } from "@workglow/util";
import {
  OPENAI_REACTIVE_TASKS,
  OPENAI_STREAM_TASKS,
  OPENAI_TASKS,
} from "./common/OpenAI_JobRunFns";
import { OpenAiProvider } from "./OpenAiProvider";

export function OPENAI_WORKER_JOBRUN_REGISTER() {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new OpenAiProvider(
    OPENAI_TASKS,
    OPENAI_STREAM_TASKS,
    OPENAI_REACTIVE_TASKS
  ).registerOnWorkerServer(workerServer);
  workerServer.sendReady();
  getLogger().info("OPENAI_WORKER_JOBRUN registered");
}
