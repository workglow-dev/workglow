/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { getLogger, globalServiceRegistry, WORKER_SERVER } from "@workglow/util";
import { AnthropicProvider } from "./AnthropicProvider";
import {
  ANTHROPIC_REACTIVE_TASKS,
  ANTHROPIC_STREAM_TASKS,
  ANTHROPIC_TASKS,
} from "./common/Anthropic_JobRunFns";

export async function registerAnthropicInline(options?: AiProviderRegisterOptions): Promise<void> {
  await new AnthropicProvider(
    ANTHROPIC_TASKS,
    ANTHROPIC_STREAM_TASKS,
    ANTHROPIC_REACTIVE_TASKS
  ).register(options ?? {});
}

export async function registerAnthropic(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  await new AnthropicProvider().register(options);
}

export function registerAnthropicWorker(): void {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new AnthropicProvider(
    ANTHROPIC_TASKS,
    ANTHROPIC_STREAM_TASKS,
    ANTHROPIC_REACTIVE_TASKS
  ).registerOnWorkerServer(workerServer);
  workerServer.sendReady();
  getLogger().info("Anthropic worker job run functions registered");
}
