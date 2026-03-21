/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import {
  GEMINI_REACTIVE_TASKS,
  GEMINI_STREAM_TASKS,
  GEMINI_TASKS,
} from "./common/Gemini_JobRunFns";
import { GoogleGeminiQueuedProvider } from "./GoogleGeminiQueuedProvider";

export async function registerGeminiInline(options?: AiProviderRegisterOptions): Promise<void> {
  await new GoogleGeminiQueuedProvider(
    GEMINI_TASKS,
    GEMINI_STREAM_TASKS,
    GEMINI_REACTIVE_TASKS
  ).register(options ?? {});
}
