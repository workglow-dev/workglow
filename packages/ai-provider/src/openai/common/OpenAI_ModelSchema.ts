/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DataPortSchema } from "@workglow/util";
import type { ModelConfig } from "@workglow/ai";

export interface OpenAIModelConfig extends ModelConfig {
  provider: "OPENAI";
  provider_config: {
    /**
     * The OpenAI model to use (e.g., "gpt-4", "gpt-3.5-turbo", "gpt-4-turbo", "o1-preview")
     */
    model: string;
    /**
     * Optional API key override (defaults to OPENAI_API_KEY environment variable)
     */
    api_key?: string;
    /**
     * Optional base URL override (defaults to https://api.openai.com/v1)
     */
    base_url?: string;
  };
}

export const OpenAIModelSchema = {
  type: "object",
  properties: {
    provider: {
      type: "string",
      const: "OPENAI",
      title: "Provider",
    },
    provider_config: {
      type: "object",
      title: "Provider Config",
      properties: {
        model: {
          type: "string",
          title: "Model",
          description: "OpenAI model name",
          examples: ["gpt-4", "gpt-3.5-turbo", "gpt-4-turbo", "o1-preview", "o1-mini"],
        },
        api_key: {
          type: "string",
          title: "API Key",
          description: "OpenAI API key (optional, defaults to OPENAI_API_KEY env var)",
        },
        base_url: {
          type: "string",
          title: "Base URL",
          description: "API base URL (optional, defaults to https://api.openai.com/v1)",
        },
      },
      required: ["model"],
    },
  },
  required: ["provider", "provider_config"],
} as const satisfies DataPortSchema;
