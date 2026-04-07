/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

const CREDENTIAL_PROVIDER_VALUES = [
  "none",
  "anthropic",
  "openai",
  "google",
  "huggingface",
  "custom",
] as const;

/**
 * Allowed provider values for credential metadata (CLI, builder UI, and JSON schema).
 */
export const CREDENTIAL_PROVIDER_SCHEMA_ENUM = CREDENTIAL_PROVIDER_VALUES;

/** Sentinel stored in UI state; persist as empty / omit provider when this is selected. */
export const CREDENTIAL_PROVIDER_NONE = CREDENTIAL_PROVIDER_VALUES[0];

export type CredentialProviderValue = (typeof CREDENTIAL_PROVIDER_VALUES)[number];

/**
 * Rows for select UIs (e.g. builder). Values must match {@link CREDENTIAL_PROVIDER_SCHEMA_ENUM}.
 */
export const CREDENTIAL_PROVIDER_OPTIONS = [
  { value: CREDENTIAL_PROVIDER_VALUES[0], label: "None" },
  { value: CREDENTIAL_PROVIDER_VALUES[1], label: "Anthropic" },
  { value: CREDENTIAL_PROVIDER_VALUES[2], label: "OpenAI" },
  { value: CREDENTIAL_PROVIDER_VALUES[3], label: "Google" },
  { value: CREDENTIAL_PROVIDER_VALUES[4], label: "Hugging Face" },
  { value: CREDENTIAL_PROVIDER_VALUES[5], label: "Custom" },
] as const satisfies ReadonlyArray<{
  readonly value: CredentialProviderValue;
  readonly label: string;
}>;

export type CredentialProviderOption = (typeof CREDENTIAL_PROVIDER_OPTIONS)[number];
