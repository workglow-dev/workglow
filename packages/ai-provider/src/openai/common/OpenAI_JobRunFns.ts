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
 * Models that require max_completion_tokens instead of max_tokens
 * This includes newer models like o1-preview, o1-mini, and potentially future models
 */
const MODELS_REQUIRING_MAX_COMPLETION_TOKENS = [
  "o1-preview",
  "o1-mini",
  "o1",
  // Add future models here as needed
];

/**
 * Determines whether to use max_completion_tokens based on the model name
 */
function shouldUseMaxCompletionTokens(model: string): boolean {
  return MODELS_REQUIRING_MAX_COMPLETION_TOKENS.some((prefix) => model.startsWith(prefix));
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
  const requestBody: any = {
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
      const errorData = await response.json().catch(() => ({}));
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
