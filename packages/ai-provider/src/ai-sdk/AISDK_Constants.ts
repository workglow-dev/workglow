/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export const AI_SDK_PROVIDER_IDS = ["openai", "anthropic", "google", "ollama"] as const;
export type AiSdkProviderId = (typeof AI_SDK_PROVIDER_IDS)[number];
