/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import OpenAI from "openai";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

function getClient(model: OpenAiModelConfig | undefined): OpenAI {
  const apiKey =
    model?.provider_config?.api_key ||
    (typeof process !== "undefined" ? process.env?.OPENAI_API_KEY : undefined);
  if (!apiKey) {
    throw new Error(
      "Missing OpenAI API key: set provider_config.api_key or the OPENAI_API_KEY environment variable."
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: model?.provider_config?.base_url || undefined,
    organization: model?.provider_config?.organization || undefined,
    dangerouslyAllowBrowser: true,
  });
}

function getModelName(model: OpenAiModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

export const OpenAI_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  OpenAiModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting OpenAI text generation");
  const client = getClient(model);
  const modelName = getModelName(model);

  const response = await client.chat.completions.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      frequency_penalty: input.frequencyPenalty,
      presence_penalty: input.presencePenalty,
    },
    { signal }
  );

  update_progress(100, "Completed OpenAI text generation");
  return { text: response.choices[0]?.message?.content ?? "" };
};

export const OpenAI_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  OpenAiModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting OpenAI text embedding");
  const client = getClient(model);
  const modelName = getModelName(model);

  const response = await client.embeddings.create(
    {
      model: modelName,
      input: input.text,
    },
    { signal }
  );

  update_progress(100, "Completed OpenAI text embedding");

  if (Array.isArray(input.text)) {
    return {
      vector: response.data.map(
        (item: { embedding: number[] }) => new Float32Array(item.embedding)
      ),
    };
  }
  return { vector: new Float32Array(response.data[0].embedding) };
};

export const OpenAI_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  OpenAiModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting OpenAI text rewriting");
  const client = getClient(model);
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

  update_progress(100, "Completed OpenAI text rewriting");
  return { text: response.choices[0]?.message?.content ?? "" };
};

export const OpenAI_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  OpenAiModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting OpenAI text summarization");
  const client = getClient(model);
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

  update_progress(100, "Completed OpenAI text summarization");
  return { text: response.choices[0]?.message?.content ?? "" };
};

// ========================================================================
// Streaming implementations (append mode)
// ========================================================================

export const OpenAI_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  OpenAiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const client = getClient(model);
  const modelName = getModelName(model);

  const stream = await client.chat.completions.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      max_tokens: input.maxTokens,
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
      yield { type: "text-delta", textDelta: delta };
    }
  }
  yield { type: "finish", data: {} as TextGenerationTaskOutput };
};

export const OpenAI_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  OpenAiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  const client = getClient(model);
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
      yield { type: "text-delta", textDelta: delta };
    }
  }
  yield { type: "finish", data: {} as TextRewriterTaskOutput };
};

export const OpenAI_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  OpenAiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
  const client = getClient(model);
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
      yield { type: "text-delta", textDelta: delta };
    }
  }
  yield { type: "finish", data: {} as TextSummaryTaskOutput };
};

// ========================================================================
// Task registries
// ========================================================================

export const OPENAI_TASKS: Record<string, AiProviderRunFn<any, any, OpenAiModelConfig>> = {
  TextGenerationTask: OpenAI_TextGeneration,
  TextEmbeddingTask: OpenAI_TextEmbedding,
  TextRewriterTask: OpenAI_TextRewriter,
  TextSummaryTask: OpenAI_TextSummary,
};

export const OPENAI_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, OpenAiModelConfig>
> = {
  TextGenerationTask: OpenAI_TextGeneration_Stream,
  TextRewriterTask: OpenAI_TextRewriter_Stream,
  TextSummaryTask: OpenAI_TextSummary_Stream,
};
