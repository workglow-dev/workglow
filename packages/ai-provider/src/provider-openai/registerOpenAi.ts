/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { getLogger, globalServiceRegistry, WORKER_SERVER } from "@workglow/util";
import {
  OPENAI_REACTIVE_TASKS,
  OPENAI_STREAM_TASKS,
  OPENAI_TASKS,
} from "./common/OpenAI_JobRunFns";
import { OpenAiProvider } from "./OpenAiProvider";

export async function registerOpenAiInline(options?: AiProviderRegisterOptions): Promise<void> {
  await new OpenAiProvider(OPENAI_TASKS, OPENAI_STREAM_TASKS, OPENAI_REACTIVE_TASKS).register(
    options ?? {}
  );
}

export async function registerOpenAi(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  await new OpenAiProvider().register(options);
}

export function registerOpenAiWorker(): void {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new OpenAiProvider(
    OPENAI_TASKS,
    OPENAI_STREAM_TASKS,
    OPENAI_REACTIVE_TASKS
  ).registerOnWorkerServer(workerServer);
  workerServer.sendReady();
  getLogger().info("OpenAI worker job run functions registered");
}
