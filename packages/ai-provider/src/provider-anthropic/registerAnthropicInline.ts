/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import {
  ANTHROPIC_REACTIVE_TASKS,
  ANTHROPIC_STREAM_TASKS,
  ANTHROPIC_TASKS,
} from "./common/Anthropic_JobRunFns";
import { AnthropicProvider } from "./AnthropicProvider";

export async function registerAnthropicInline(options?: AiProviderRegisterOptions): Promise<void> {
  await new AnthropicProvider(
    ANTHROPIC_TASKS,
    ANTHROPIC_STREAM_TASKS,
    ANTHROPIC_REACTIVE_TASKS
  ).register(options ?? {});
}
