/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { TFMP_TASKS } from "./common/TFMP_JobRunFns";
import { TensorFlowMediaPipeProvider } from "./TensorFlowMediaPipeProvider";

export async function registerTensorFlowMediaPipeInline(
  options?: AiProviderRegisterOptions
): Promise<void> {
  await new TensorFlowMediaPipeProvider(TFMP_TASKS).register(options ?? {});
}
