/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderReactiveRunFn,
  AiProviderRunFn,
  AiProviderStreamFn,
  CountTokensTaskInput,
  CountTokensTaskOutput,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";

let _sdk: typeof import("@anthropic-ai/sdk") | undefined;
async function loadAnthropicSDK() {
  if (!_sdk) {
    try {
      _sdk = await import("@anthropic-ai/sdk");
    } catch {
      throw new Error(
        "@anthropic-ai/sdk is required for Anthropic tasks. Install it with: bun add @anthropic-ai/sdk"
      );
    }
  }
  return _sdk.default;
}

async function getClient(model: AnthropicModelConfig | undefined) {
  const Anthropic = await loadAnthropicSDK();
  const apiKey =
    model?.provider_config?.api_key ||
    (typeof process !== "undefined" ? process.env?.ANTHROPIC_API_KEY : undefined);
  if (!apiKey) {
    throw new Error(
      "Missing Anthropic API key: set provider_config.api_key or the ANTHROPIC_API_KEY environment variable."
    );
  }
  return new Anthropic({
    apiKey,
    baseURL: model?.provider_config?.base_url || undefined,
    dangerouslyAllowBrowser: true,
  });
}

function getModelName(model: AnthropicModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

function getMaxTokens(
  input: { maxTokens?: number },
  model: AnthropicModelConfig | undefined
): number {
  return input.maxTokens ?? model?.provider_config?.max_tokens ?? 1024;
}

export const Anthropic_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Anthropic text generation");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const response = await client.messages.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      max_tokens: getMaxTokens(input, model),
      temperature: input.temperature,
      top_p: input.topP,
    },
    { signal }
  );

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  update_progress(100, "Completed Anthropic text generation");
  return { text };
};

export const Anthropic_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Anthropic text rewriting");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const response = await client.messages.create(
    {
      model: modelName,
      system: input.prompt,
      messages: [{ role: "user", content: input.text }],
      max_tokens: getMaxTokens({}, model),
    },
    { signal }
  );

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  update_progress(100, "Completed Anthropic text rewriting");
  return { text };
};

export const Anthropic_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Anthropic text summarization");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const response = await client.messages.create(
    {
      model: modelName,
      system: "Summarize the following text concisely.",
      messages: [{ role: "user", content: input.text }],
      max_tokens: getMaxTokens({}, model),
    },
    { signal }
  );

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  update_progress(100, "Completed Anthropic text summarization");
  return { text };
};

// ========================================================================
// Streaming implementations (append mode)
// ========================================================================

export const Anthropic_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  AnthropicModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const stream = client.messages.stream(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      max_tokens: getMaxTokens(input, model),
      temperature: input.temperature,
      top_p: input.topP,
    },
    { signal }
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield { type: "text-delta", port: "text", textDelta: event.delta.text };
    }
  }
  yield { type: "finish", data: {} as TextGenerationTaskOutput };
};

export const Anthropic_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  AnthropicModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const stream = client.messages.stream(
    {
      model: modelName,
      system: input.prompt,
      messages: [{ role: "user", content: input.text }],
      max_tokens: getMaxTokens({}, model),
    },
    { signal }
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield { type: "text-delta", port: "text", textDelta: event.delta.text };
    }
  }
  yield { type: "finish", data: {} as TextRewriterTaskOutput };
};

export const Anthropic_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  AnthropicModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const stream = client.messages.stream(
    {
      model: modelName,
      system: "Summarize the following text concisely.",
      messages: [{ role: "user", content: input.text }],
      max_tokens: getMaxTokens({}, model),
    },
    { signal }
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield { type: "text-delta", port: "text", textDelta: event.delta.text };
    }
  }
  yield { type: "finish", data: {} as TextSummaryTaskOutput };
};

export const Anthropic_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  AnthropicModelConfig
> = async (input, model, onProgress, signal) => {
  const client = await getClient(model);
  const result = await client.messages.countTokens({
    model: getModelName(model),
    messages: [{ role: "user", content: input.text }],
  });
  return { count: result.input_tokens };
};

export const Anthropic_CountTokens_Reactive: AiProviderReactiveRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  AnthropicModelConfig
> = async (input, _output, _model) => {
  return { count: Math.ceil(input.text.length / 4) };
};

// ========================================================================
// Task registries
// ========================================================================

export const ANTHROPIC_TASKS: Record<string, AiProviderRunFn<any, any, AnthropicModelConfig>> = {
  CountTokensTask: Anthropic_CountTokens,
  TextGenerationTask: Anthropic_TextGeneration,
  TextRewriterTask: Anthropic_TextRewriter,
  TextSummaryTask: Anthropic_TextSummary,
};

export const ANTHROPIC_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, AnthropicModelConfig>
> = {
  TextGenerationTask: Anthropic_TextGeneration_Stream,
  TextRewriterTask: Anthropic_TextRewriter_Stream,
  TextSummaryTask: Anthropic_TextSummary_Stream,
};

export const ANTHROPIC_REACTIVE_TASKS: Record<
  string,
  AiProviderReactiveRunFn<any, any, AnthropicModelConfig>
> = {
  CountTokensTask: Anthropic_CountTokens_Reactive,
};
