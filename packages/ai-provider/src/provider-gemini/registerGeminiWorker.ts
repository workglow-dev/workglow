/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerProviderWorker } from "../common/registerProvider";
import {
  GEMINI_REACTIVE_TASKS,
  GEMINI_STREAM_TASKS,
  GEMINI_TASKS,
} from "./common/Gemini_JobRunFns";
import { GoogleGeminiProvider } from "./GoogleGeminiProvider";

export async function registerGeminiWorker(): Promise<void> {
  await registerProviderWorker(
    (ws) =>
      new GoogleGeminiProvider(
        GEMINI_TASKS,
        GEMINI_STREAM_TASKS,
        GEMINI_REACTIVE_TASKS
      ).registerOnWorkerServer(ws),
    "Google Gemini"
  );
}
