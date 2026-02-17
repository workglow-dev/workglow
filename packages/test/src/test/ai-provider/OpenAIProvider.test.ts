/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import type { TextGenerationTaskInput, TextGenerationTaskOutput } from "@workglow/ai";
import { OpenAI_TextGeneration } from "@workglow/ai-provider";
import type { OpenAIModelConfig } from "@workglow/ai-provider";

const mock = vi.fn;

describe("OpenAI Provider - Token Parameter Selection", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = mock();
    globalThis.fetch = fetchMock as any;
    
    // Set a test API key
    process.env.OPENAI_API_KEY = "test-api-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.OPENAI_API_KEY;
  });

  test("should use max_tokens for GPT-3.5 models", async () => {
    const model: OpenAIModelConfig = {
      provider: "OPENAI",
      provider_config: {
        model: "gpt-3.5-turbo",
      },
    };

    const input: TextGenerationTaskInput = {
      model,
      prompt: "Hello, world!",
      maxTokens: 100,
    };

    const mockResponse = {
      choices: [{ message: { content: "Generated text" } }],
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const onProgress = mock();
    const signal = new AbortController().signal;

    await OpenAI_TextGeneration(input, model, onProgress, signal);

    // Verify that fetch was called
    expect(fetchMock).toHaveBeenCalledTimes(1);
    
    // Get the actual request body that was sent
    const callArgs = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    
    // For GPT-3.5, should use max_tokens, not max_completion_tokens
    expect(requestBody).toHaveProperty("max_tokens", 100);
    expect(requestBody).not.toHaveProperty("max_completion_tokens");
  });

  test("should use max_completion_tokens for o1-preview model", async () => {
    const model: OpenAIModelConfig = {
      provider: "OPENAI",
      provider_config: {
        model: "o1-preview",
      },
    };

    const input: TextGenerationTaskInput = {
      model,
      prompt: "Hello, world!",
      maxTokens: 100,
    };

    const mockResponse = {
      choices: [{ message: { content: "Generated text" } }],
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const onProgress = mock();
    const signal = new AbortController().signal;

    await OpenAI_TextGeneration(input, model, onProgress, signal);

    // Verify that fetch was called
    expect(fetchMock).toHaveBeenCalledTimes(1);
    
    // Get the actual request body that was sent
    const callArgs = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    
    // For o1-preview, should use max_completion_tokens, not max_tokens
    expect(requestBody).toHaveProperty("max_completion_tokens", 100);
    expect(requestBody).not.toHaveProperty("max_tokens");
  });

  test("should use max_completion_tokens for o1-mini model", async () => {
    const model: OpenAIModelConfig = {
      provider: "OPENAI",
      provider_config: {
        model: "o1-mini",
      },
    };

    const input: TextGenerationTaskInput = {
      model,
      prompt: "Hello, world!",
      maxTokens: 50,
    };

    const mockResponse = {
      choices: [{ message: { content: "Generated text" } }],
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const onProgress = mock();
    const signal = new AbortController().signal;

    await OpenAI_TextGeneration(input, model, onProgress, signal);

    // Verify that fetch was called
    expect(fetchMock).toHaveBeenCalledTimes(1);
    
    // Get the actual request body that was sent
    const callArgs = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    
    // For o1-mini, should use max_completion_tokens, not max_tokens
    expect(requestBody).toHaveProperty("max_completion_tokens", 50);
    expect(requestBody).not.toHaveProperty("max_tokens");
  });

  test("should use max_tokens for GPT-4 models", async () => {
    const model: OpenAIModelConfig = {
      provider: "OPENAI",
      provider_config: {
        model: "gpt-4",
      },
    };

    const input: TextGenerationTaskInput = {
      model,
      prompt: "Hello, world!",
      maxTokens: 200,
    };

    const mockResponse = {
      choices: [{ message: { content: "Generated text" } }],
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const onProgress = mock();
    const signal = new AbortController().signal;

    await OpenAI_TextGeneration(input, model, onProgress, signal);

    // Verify that fetch was called
    expect(fetchMock).toHaveBeenCalledTimes(1);
    
    // Get the actual request body that was sent
    const callArgs = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    
    // For GPT-4, should use max_tokens, not max_completion_tokens
    expect(requestBody).toHaveProperty("max_tokens", 200);
    expect(requestBody).not.toHaveProperty("max_completion_tokens");
  });

  test("should not include token parameter when maxTokens is undefined", async () => {
    const model: OpenAIModelConfig = {
      provider: "OPENAI",
      provider_config: {
        model: "gpt-3.5-turbo",
      },
    };

    const input: TextGenerationTaskInput = {
      model,
      prompt: "Hello, world!",
      // maxTokens is undefined
    };

    const mockResponse = {
      choices: [{ message: { content: "Generated text" } }],
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const onProgress = mock();
    const signal = new AbortController().signal;

    await OpenAI_TextGeneration(input, model, onProgress, signal);

    // Verify that fetch was called
    expect(fetchMock).toHaveBeenCalledTimes(1);
    
    // Get the actual request body that was sent
    const callArgs = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    
    // When maxTokens is undefined, neither parameter should be present
    expect(requestBody).not.toHaveProperty("max_tokens");
    expect(requestBody).not.toHaveProperty("max_completion_tokens");
  });

  test("should include other parameters when provided", async () => {
    const model: OpenAIModelConfig = {
      provider: "OPENAI",
      provider_config: {
        model: "gpt-3.5-turbo",
      },
    };

    const input: TextGenerationTaskInput = {
      model,
      prompt: "Hello, world!",
      maxTokens: 100,
      temperature: 0.7,
      topP: 0.9,
      frequencyPenalty: 0.5,
      presencePenalty: 0.3,
    };

    const mockResponse = {
      choices: [{ message: { content: "Generated text" } }],
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const onProgress = mock();
    const signal = new AbortController().signal;

    await OpenAI_TextGeneration(input, model, onProgress, signal);

    // Verify that fetch was called
    expect(fetchMock).toHaveBeenCalledTimes(1);
    
    // Get the actual request body that was sent
    const callArgs = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    
    // Verify all parameters are correctly mapped
    expect(requestBody).toHaveProperty("temperature", 0.7);
    expect(requestBody).toHaveProperty("top_p", 0.9);
    expect(requestBody).toHaveProperty("frequency_penalty", 0.5);
    expect(requestBody).toHaveProperty("presence_penalty", 0.3);
  });

  test("should use max_completion_tokens for GPT-4o models", async () => {
    const model: OpenAIModelConfig = {
      provider: "OPENAI",
      provider_config: {
        model: "gpt-4o",
      },
    };

    const input: TextGenerationTaskInput = {
      model,
      prompt: "Hello, world!",
      maxTokens: 150,
    };

    const mockResponse = {
      choices: [{ message: { content: "Generated text" } }],
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const onProgress = mock();
    const signal = new AbortController().signal;

    await OpenAI_TextGeneration(input, model, onProgress, signal);

    // Verify that fetch was called
    expect(fetchMock).toHaveBeenCalledTimes(1);
    
    // Get the actual request body that was sent
    const callArgs = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    
    // For GPT-4o, should use max_completion_tokens
    expect(requestBody).toHaveProperty("max_completion_tokens", 150);
    expect(requestBody).not.toHaveProperty("max_tokens");
  });

  test("should use max_completion_tokens for unknown/future models (default behavior)", async () => {
    const model: OpenAIModelConfig = {
      provider: "OPENAI",
      provider_config: {
        model: "gpt-5-future-model", // Hypothetical future model
      },
    };

    const input: TextGenerationTaskInput = {
      model,
      prompt: "Hello, world!",
      maxTokens: 250,
    };

    const mockResponse = {
      choices: [{ message: { content: "Generated text" } }],
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const onProgress = mock();
    const signal = new AbortController().signal;

    await OpenAI_TextGeneration(input, model, onProgress, signal);

    // Verify that fetch was called
    expect(fetchMock).toHaveBeenCalledTimes(1);
    
    // Get the actual request body that was sent
    const callArgs = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    
    // For unknown models, default to max_completion_tokens (future-proof)
    expect(requestBody).toHaveProperty("max_completion_tokens", 250);
    expect(requestBody).not.toHaveProperty("max_tokens");
  });
});
