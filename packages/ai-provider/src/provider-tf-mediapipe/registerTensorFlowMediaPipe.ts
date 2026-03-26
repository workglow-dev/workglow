/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { TensorFlowMediaPipeQueuedProvider } from "./TensorFlowMediaPipeQueuedProvider";

export async function registerTensorFlowMediaPipe(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  await new TensorFlowMediaPipeQueuedProvider().register(options);
}
