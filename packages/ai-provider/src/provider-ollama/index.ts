/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { getLogger, globalServiceRegistry, WORKER_SERVER } from "@workglow/util";
import { OLLAMA_STREAM_TASKS, OLLAMA_TASKS } from "./common/Ollama_JobRunFns";
import { OllamaProvider } from "./OllamaProvider";

export * from "./common/Ollama_Constants";
export * from "./common/Ollama_ModelSchema";
export * from "./common/Ollama_Client";

export async function registerOllamaInline(options?: AiProviderRegisterOptions): Promise<void> {
  await new OllamaProvider(OLLAMA_TASKS, OLLAMA_STREAM_TASKS).register(options ?? {});
}

export async function registerOllama(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  await new OllamaProvider().register(options);
}

export function registerOllamaWorker(): void {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new OllamaProvider(OLLAMA_TASKS, OLLAMA_STREAM_TASKS).registerOnWorkerServer(workerServer);
  workerServer.sendReady();
  getLogger().info("Ollama worker job run functions registered");
}
