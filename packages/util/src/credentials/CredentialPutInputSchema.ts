/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "../json-schema/DataPortSchema";
import { CREDENTIAL_PROVIDER_SCHEMA_ENUM } from "./CredentialProviderOptions";

/**
 * CLI / form input for storing a credential (key, secret, optional metadata).
 */
export const CredentialPutInputSchema = {
  type: "object",
  properties: {
    key: {
      type: "string",
      title: "Key",
      description: 'Unique identifier (e.g. "openai-api-key")',
    },
    value: {
      type: "string",
      title: "Value",
      description: "Secret value (API key, token, or password)",
      format: "password",
    },
    label: {
      type: "string",
      title: "Label",
      description: "Human-readable label (optional)",
    },
    provider: {
      type: "string",
      title: "Provider",
      description: "Optional provider this credential is associated with",
      enum: [...CREDENTIAL_PROVIDER_SCHEMA_ENUM],
    },
  },
  required: ["key", "value"],
} as const satisfies DataPortSchemaObject;
