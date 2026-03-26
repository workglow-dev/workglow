/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { TFMP_TASKS } from "./common/TFMP_JobRunFns";
import { TensorFlowMediaPipeQueuedProvider } from "./TensorFlowMediaPipeQueuedProvider";

export async function registerTensorFlowMediaPipeInline(
  options?: AiProviderRegisterOptions
): Promise<void> {
  await new TensorFlowMediaPipeQueuedProvider(TFMP_TASKS).register(options ?? {});
}
