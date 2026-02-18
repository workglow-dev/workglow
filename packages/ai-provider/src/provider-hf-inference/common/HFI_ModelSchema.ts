/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai";
import { DataPortSchemaObject, FromSchema } from "@workglow/util";
import { HF_INFERENCE } from "./HFI_Constants";

export const HfInferenceModelSchema = {
  type: "object",
  properties: {
    provider: {
      const: HF_INFERENCE,
      description: "Discriminator: Hugging Face Inference API provider.",
    },
    provider_config: {
      type: "object",
      description: "Hugging Face Inference-specific configuration.",
      properties: {
        model_name: {
          type: "string",
          description: "The Hugging Face model identifier (e.g., 'meta-llama/Llama-3.3-70B-Instruct').",
        },
        api_key: {
          type: "string",
          description: "Hugging Face API key. Falls back to HF_TOKEN environment variable if not set.",
        },
        provider: {
          type: "string",
          description: "Optional provider to route to specific HF inference providers (e.g., 'fal-ai', 'fireworks-ai').",
        },
      },
      required: ["model_name"],
      additionalProperties: false,
    },
  },
  required: ["provider", "provider_config"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export const HfInferenceModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelRecordSchema.properties,
    ...HfInferenceModelSchema.properties,
  },
  required: [...ModelRecordSchema.required, ...HfInferenceModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type HfInferenceModelRecord = FromSchema<typeof HfInferenceModelRecordSchema>;

export const HfInferenceModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...HfInferenceModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...HfInferenceModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type HfInferenceModelConfig = FromSchema<typeof HfInferenceModelConfigSchema>;
