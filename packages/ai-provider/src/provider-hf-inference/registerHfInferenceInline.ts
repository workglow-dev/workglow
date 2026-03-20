/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { HFI_STREAM_TASKS, HFI_TASKS } from "./common/HFI_JobRunFns";
import { HfInferenceProvider } from "./HfInferenceProvider";

export async function registerHfInferenceInline(
  options?: AiProviderRegisterOptions
): Promise<void> {
  await new HfInferenceProvider(HFI_TASKS, HFI_STREAM_TASKS).register(options ?? {});
}
