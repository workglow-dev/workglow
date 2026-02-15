/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai";
import { DataPortSchemaObject, FromSchema } from "@workglow/util";
import { AI_SDK_PROVIDER_IDS } from "./AISDK_Constants";

export const AiSdkModelSchema = {
  type: "object",
  properties: {
    provider: {
      type: "string",
      enum: AI_SDK_PROVIDER_IDS,
      description: "Cloud provider managed via @ai-sdk/* packages.",
    },
    provider_config: {
      type: "object",
      properties: {
        model_id: {
          type: "string",
          description: "Provider model identifier.",
        },
        api_key: {
          type: "string",
          description: "Provider API key (optional when set via env vars).",
        },
        base_url: {
          type: "string",
          description: "Optional base URL for OpenAI-compatible endpoints.",
        },
      },
      required: ["model_id"],
      additionalProperties: true,
    },
  },
  required: ["provider", "provider_config"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export const AiSdkModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...AiSdkModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...AiSdkModelSchema.required],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export const AiSdkModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelRecordSchema.properties,
    ...AiSdkModelSchema.properties,
  },
  required: [...ModelRecordSchema.required, ...AiSdkModelSchema.required],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export type AiSdkModelConfig = FromSchema<typeof AiSdkModelConfigSchema>;
export type AiSdkModelRecord = FromSchema<typeof AiSdkModelRecordSchema>;
