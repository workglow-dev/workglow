/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { registerProviderWithWorker } from "../common/registerProvider";
import { HfInferenceQueuedProvider } from "./HfInferenceQueuedProvider";

export async function registerHfInference(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  await registerProviderWithWorker(
    new HfInferenceQueuedProvider(),
    "Hugging Face Inference",
    options
  );
}
