/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai";
import { DataPortSchemaObject, FromSchema } from "@workglow/util";
import { GOOGLE_GEMINI } from "./Gemini_Constants";

export const GeminiModelSchema = {
  type: "object",
  properties: {
    provider: {
      const: GOOGLE_GEMINI,
      description: "Discriminator: Google Gemini cloud provider.",
    },
    provider_config: {
      type: "object",
      description: "Google Gemini-specific configuration.",
      properties: {
        model_name: {
          type: "string",
          description:
            "The Gemini model identifier (e.g., 'gemini-2.0-flash', 'text-embedding-004').",
        },
        api_key: {
          type: "string",
          description: "Google AI API key. Falls back to default API key if not set.",
        },
        embedding_task_type: {
          oneOf: [
            { type: "null" },
            {
              type: "string",
              enum: [
                "RETRIEVAL_QUERY",
                "RETRIEVAL_DOCUMENT",
                "SEMANTIC_SIMILARITY",
                "CLASSIFICATION",
                "CLUSTERING",
              ],
            },
          ],
          description: "Task type hint for embedding models.",
          default: null,
        },
      },
      required: ["model_name"],
      additionalProperties: false,
    },
  },
  required: ["provider", "provider_config"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export const GeminiModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelRecordSchema.properties,
    ...GeminiModelSchema.properties,
  },
  required: [...ModelRecordSchema.required, ...GeminiModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type GeminiModelRecord = FromSchema<typeof GeminiModelRecordSchema>;

export const GeminiModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...GeminiModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...GeminiModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type GeminiModelConfig = FromSchema<typeof GeminiModelConfigSchema>;
