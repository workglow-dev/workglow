/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { FeatherlessModelConfig } from "./Featherless_ModelSchema";

let _sdk: typeof import("openai") | undefined;
async function loadOpenAISDK() {
  if (!_sdk) {
    try {
      _sdk = await import("openai");
    } catch {
      throw new Error("openai is required for Featherless tasks. Install it with: bun add openai");
    }
  }
  return _sdk.default;
}

async function getClient(model: FeatherlessModelConfig | undefined) {
  const OpenAI = await loadOpenAISDK();
  const apiKey =
    model?.provider_config?.api_key ||
    (typeof process !== "undefined" ? process.env?.FEATHERLESS_API_KEY : undefined);
  if (!apiKey) {
    throw new Error(
      "Missing Featherless API key: set provider_config.api_key or the FEATHERLESS_API_KEY environment variable."
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: "https://api.featherless.ai/v1",
    dangerouslyAllowBrowser: true,
  });
}

function getModelName(model: FeatherlessModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

export const Featherless_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  FeatherlessModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Featherless text generation");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const response = await client.chat.completions.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      max_completion_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      frequency_penalty: input.frequencyPenalty,
      presence_penalty: input.presencePenalty,
    },
    { signal }
  );

  update_progress(100, "Completed Featherless text generation");
  return { text: response.choices[0]?.message?.content ?? "" };
};

export const Featherless_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  FeatherlessModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Featherless text rewriting");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const response = await client.chat.completions.create(
    {
      model: modelName,
      messages: [
        { role: "system", content: input.prompt },
        { role: "user", content: input.text },
      ],
    },
    { signal }
  );

  update_progress(100, "Completed Featherless text rewriting");
  return { text: response.choices[0]?.message?.content ?? "" };
};

export const Featherless_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  FeatherlessModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Featherless text summarization");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const response = await client.chat.completions.create(
    {
      model: modelName,
      messages: [
        { role: "system", content: "Summarize the following text concisely." },
        { role: "user", content: input.text },
      ],
    },
    { signal }
  );

  update_progress(100, "Completed Featherless text summarization");
  return { text: response.choices[0]?.message?.content ?? "" };
};

// ========================================================================
// Streaming implementations (append mode)
// ========================================================================

export const Featherless_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  FeatherlessModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const stream = await client.chat.completions.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      max_completion_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      frequency_penalty: input.frequencyPenalty,
      presence_penalty: input.presencePenalty,
      stream: true,
    },
    { signal }
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      yield { type: "text-delta", port: "text", textDelta: delta };
    }
  }
  yield { type: "finish", data: {} as TextGenerationTaskOutput };
};

export const Featherless_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  FeatherlessModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const stream = await client.chat.completions.create(
    {
      model: modelName,
      messages: [
        { role: "system", content: input.prompt },
        { role: "user", content: input.text },
      ],
      stream: true,
    },
    { signal }
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      yield { type: "text-delta", port: "text", textDelta: delta };
    }
  }
  yield { type: "finish", data: {} as TextRewriterTaskOutput };
};

export const Featherless_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  FeatherlessModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const stream = await client.chat.completions.create(
    {
      model: modelName,
      messages: [
        { role: "system", content: "Summarize the following text concisely." },
        { role: "user", content: input.text },
      ],
      stream: true,
    },
    { signal }
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      yield { type: "text-delta", port: "text", textDelta: delta };
    }
  }
  yield { type: "finish", data: {} as TextSummaryTaskOutput };
};

// ========================================================================
// Task registries
// ========================================================================

export const FEATHERLESS_TASKS: Record<
  string,
  AiProviderRunFn<any, any, FeatherlessModelConfig>
> = {
  TextGenerationTask: Featherless_TextGeneration,
  TextRewriterTask: Featherless_TextRewriter,
  TextSummaryTask: Featherless_TextSummary,
};

export const FEATHERLESS_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, FeatherlessModelConfig>
> = {
  TextGenerationTask: Featherless_TextGeneration_Stream,
  TextRewriterTask: Featherless_TextRewriter_Stream,
  TextSummaryTask: Featherless_TextSummary_Stream,
};
