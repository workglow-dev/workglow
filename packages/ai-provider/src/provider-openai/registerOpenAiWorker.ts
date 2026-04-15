/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "../common/registerProvider";
import {
  OPENAI_REACTIVE_TASKS,
  OPENAI_STREAM_TASKS,
  OPENAI_TASKS,
} from "./common/OpenAI_JobRunFns";
import { OpenAiProvider } from "./OpenAiProvider";

export async function registerOpenAiWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) =>
      new OpenAiProvider(
        OPENAI_TASKS,
        OPENAI_STREAM_TASKS,
        OPENAI_REACTIVE_TASKS
      ).registerOnWorkerServer(ws),
    "OpenAI"
  );
}
