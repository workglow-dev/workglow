/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
} from "@workglow/ai";
import type { OpenAIModelConfig } from "./OpenAI_ModelSchema";

/**
 * Models that require or prefer max_completion_tokens instead of max_tokens.
 * 
 * According to OpenAI API documentation (as of late 2024):
 * - o1-series models (o1-preview, o1-mini) REQUIRE max_completion_tokens (will error with max_tokens)
 * - GPT-4o and newer models ACCEPT both parameters but prefer max_completion_tokens
 * - GPT-4, GPT-3.5-turbo primarily use max_tokens (but may accept both)
 * 
 * Strategy: Use max_completion_tokens for models that are known to require it or newer models
 * that prefer it, and max_tokens for older/legacy models.
 */
const MODELS_USING_MAX_COMPLETION_TOKENS = [
  "o1-preview",
  "o1-mini",
  "o1",
  // GPT-4o and newer variants
  "gpt-4o",
  "chatgpt-4o-latest",
];

/**
 * Models that should use the legacy max_tokens parameter.
 * These are older models that may not support max_completion_tokens.
 */
const MODELS_USING_MAX_TOKENS = [
  "gpt-3.5-turbo",
  "gpt-4",
  "gpt-4-turbo",
];

/**
 * Determines whether to use max_completion_tokens based on the model name.
 * Returns true for models that require or prefer max_completion_tokens.
 */
function shouldUseMaxCompletionTokens(model: string): boolean {
  // Check if it's explicitly in the max_tokens list (legacy models)
  for (const legacyModel of MODELS_USING_MAX_TOKENS) {
    if (model === legacyModel || model.startsWith(`${legacyModel}-`)) {
      return false;
    }
  }
  
  // Check if it's explicitly in the max_completion_tokens list
  for (const newModel of MODELS_USING_MAX_COMPLETION_TOKENS) {
    if (model === newModel || model.startsWith(`${newModel}-`)) {
      return true;
    }
  }
  
  // Default: for unknown/future models, use max_completion_tokens as it's the newer standard
  // This makes the implementation future-proof for new model releases
  return true;
}

/**
 * Get API key from model config or environment
 */
function getApiKey(model: OpenAIModelConfig | undefined): string {
  const apiKey = model?.provider_config?.api_key || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OpenAI API Key: ensure OPENAI_API_KEY is set in environment variables or provide api_key in model config"
    );
  }
  return apiKey;
}

/**
 * Get base URL from model config or use default
 */
function getBaseUrl(model: OpenAIModelConfig | undefined): string {
  return model?.provider_config?.base_url || "https://api.openai.com/v1";
}

/**
 * Download/prepare model (no-op for OpenAI as models are cloud-based)
 */
export const OpenAI_DownloadModel: AiProviderRunFn<
  DownloadModelTaskRunInput,
  DownloadModelTaskRunOutput,
  OpenAIModelConfig
> = async (input, model, onProgress, signal) => {
  // Verify API key is available
  getApiKey(model);
  
  onProgress(100, "OpenAI provider ready");
  
  return {
    model: model?.provider_config?.model || input.model,
    dimensions: 0,
    normalize: false,
  };
};

/**
 * OpenAI Chat Completions API request body
 */
interface OpenAIChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

/**
 * Text generation using OpenAI's Chat Completions API
 */
export const OpenAI_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  OpenAIModelConfig
> = async (input, model, onProgress, signal) => {
  const apiKey = getApiKey(model);
  const baseUrl = getBaseUrl(model);
  const modelName = model?.provider_config?.model || "gpt-3.5-turbo";
  
  onProgress(10, "Starting OpenAI text generation");
  
  // Determine which token parameter to use based on model
  const useMaxCompletionTokens = shouldUseMaxCompletionTokens(modelName);
  
  // Build request body with appropriate token parameter
  const requestBody: OpenAIChatCompletionRequest = {
    model: modelName,
    messages: [
      {
        role: "user",
        content: input.prompt,
      },
    ],
  };
  
  // Add token limit if specified
  if (input.maxTokens !== undefined) {
    if (useMaxCompletionTokens) {
      requestBody.max_completion_tokens = input.maxTokens;
    } else {
      requestBody.max_tokens = input.maxTokens;
    }
  }
  
  // Add other parameters if specified
  if (input.temperature !== undefined) {
    requestBody.temperature = input.temperature;
  }
  if (input.topP !== undefined) {
    requestBody.top_p = input.topP;
  }
  if (input.frequencyPenalty !== undefined) {
    requestBody.frequency_penalty = input.frequencyPenalty;
  }
  if (input.presencePenalty !== undefined) {
    requestBody.presence_penalty = input.presencePenalty;
  }
  
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal,
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ 
        error: "Unable to parse error response",
        status: response.status,
        statusText: response.statusText 
      }));
      throw new Error(
        `OpenAI API error: ${response.status} ${response.statusText}. ${JSON.stringify(errorData)}`
      );
    }
    
    const data = await response.json();
    onProgress(100, "Completed OpenAI text generation");
    
    return {
      text: data.choices?.[0]?.message?.content?.trim() || "",
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`OpenAI text generation failed: ${error.message}`);
    }
    throw error;
  }
};

/**
 * Export all OpenAI task implementations
 */
export const OPENAI_TASKS = {
  DownloadModelTask: OpenAI_DownloadModel,
  TextGenerationTask: OpenAI_TextGeneration,
};
