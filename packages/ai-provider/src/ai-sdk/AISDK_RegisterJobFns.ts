/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { register_AISDK_InlineJobFns } from "./registry/AISDK_Inline_RegisterJobFns";

/**
 * AI SDK-backed providers execute through ModelInstanceFactory + AiJob V3 adapters.
 * No per-task AiProviderRunFn registration is needed for text/embedding/image paths.
 */
export async function register_AISDK_JobFns(): Promise<void> {
  await register_AISDK_InlineJobFns();
}
