/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerCloudProviderFactories } from "../AISDK_Factories";

/**
 * Registers AI SDK model factories for inline execution.
 */
export async function register_AISDK_InlineJobFns(): Promise<void> {
  registerCloudProviderFactories();
}
