/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import {
  LLAMACPP_REACTIVE_TASKS,
  LLAMACPP_STREAM_TASKS,
  LLAMACPP_TASKS,
} from "./common/LlamaCpp_JobRunFns";
import { LlamaCppProvider } from "./LlamaCppProvider";

export async function registerLlamaCppInline(options?: AiProviderRegisterOptions): Promise<void> {
  await new LlamaCppProvider(
    LLAMACPP_TASKS,
    LLAMACPP_STREAM_TASKS,
    LLAMACPP_REACTIVE_TASKS
  ).register(options ?? {});
}
