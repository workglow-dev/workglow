/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai";
import { DataPortSchemaObject, FromSchema } from "@workglow/util";
import { FEATHERLESS_AI } from "./Featherless_Constants";

export const FeatherlessModelSchema = {
  type: "object",
  properties: {
    provider: {
      const: FEATHERLESS_AI,
      description: "Discriminator: Featherless.ai provider.",
    },
    provider_config: {
      type: "object",
      description: "Featherless.ai-specific configuration.",
      properties: {
        model_name: {
          type: "string",
          description: "The Featherless.ai model identifier.",
        },
        api_key: {
          type: "string",
          description: "Featherless.ai API key. Falls back to FEATHERLESS_API_KEY environment variable if not set.",
        },
      },
      required: ["model_name"],
      additionalProperties: false,
    },
  },
  required: ["provider", "provider_config"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export const FeatherlessModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelRecordSchema.properties,
    ...FeatherlessModelSchema.properties,
  },
  required: [...ModelRecordSchema.required, ...FeatherlessModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type FeatherlessModelRecord = FromSchema<typeof FeatherlessModelRecordSchema>;

export const FeatherlessModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...FeatherlessModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...FeatherlessModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type FeatherlessModelConfig = FromSchema<typeof FeatherlessModelConfigSchema>;
