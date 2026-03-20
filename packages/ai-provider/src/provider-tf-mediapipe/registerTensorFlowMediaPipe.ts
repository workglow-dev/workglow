/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { TensorFlowMediaPipeProvider } from "./TensorFlowMediaPipeProvider";

export async function registerTensorFlowMediaPipe(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  await new TensorFlowMediaPipeProvider().register(options);
}
