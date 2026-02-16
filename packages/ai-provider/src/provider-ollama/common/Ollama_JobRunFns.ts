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
import { Ollama } from "ollama/browser";
import { OLLAMA_DEFAULT_BASE_URL } from "./Ollama_Constants";
import type { OllamaModelConfig } from "./Ollama_ModelSchema";

function getClient(model: OllamaModelConfig | undefined): Ollama {
  const host = model?.provider_config?.base_url || OLLAMA_DEFAULT_BASE_URL;
  return new Ollama({ host });
}

function getModelName(model: OllamaModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

export const Ollama_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  OllamaModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Ollama text generation");
  const client = getClient(model);
  const modelName = getModelName(model);

  const response = await client.chat({
    model: modelName,
    messages: [{ role: "user", content: input.prompt }],
    options: {
      temperature: input.temperature,
      top_p: input.topP,
      num_predict: input.maxTokens,
      frequency_penalty: input.frequencyPenalty,
      presence_penalty: input.presencePenalty,
    },
  });

  update_progress(100, "Completed Ollama text generation");
  return { text: response.message.content };
};

export const Ollama_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  OllamaModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Ollama text embedding");
  const client = getClient(model);
  const modelName = getModelName(model);

  const texts = Array.isArray(input.text) ? input.text : [input.text];

  const response = await client.embed({
    model: modelName,
    input: texts,
  });

  update_progress(100, "Completed Ollama text embedding");

  if (Array.isArray(input.text)) {
    return {
      vector: response.embeddings.map((e) => new Float32Array(e)),
    };
  }
  return { vector: new Float32Array(response.embeddings[0]) };
};

export const Ollama_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  OllamaModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Ollama text rewriting");
  const client = getClient(model);
  const modelName = getModelName(model);

  const response = await client.chat({
    model: modelName,
    messages: [
      { role: "system", content: input.prompt },
      { role: "user", content: input.text },
    ],
  });

  update_progress(100, "Completed Ollama text rewriting");
  return { text: response.message.content };
};

export const Ollama_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  OllamaModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Ollama text summarization");
  const client = getClient(model);
  const modelName = getModelName(model);

  const response = await client.chat({
    model: modelName,
    messages: [
      { role: "system", content: "Summarize the following text concisely." },
      { role: "user", content: input.text },
    ],
  });

  update_progress(100, "Completed Ollama text summarization");
  return { text: response.message.content };
};

// ========================================================================
// Streaming implementations (append mode)
// ========================================================================

export const Ollama_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  OllamaModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const client = getClient(model);
  const modelName = getModelName(model);

  const stream = await client.chat({
    model: modelName,
    messages: [{ role: "user", content: input.prompt }],
    options: {
      temperature: input.temperature,
      top_p: input.topP,
      num_predict: input.maxTokens,
      frequency_penalty: input.frequencyPenalty,
      presence_penalty: input.presencePenalty,
    },
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.message.content;
    if (delta) {
      yield { type: "text-delta", textDelta: delta };
    }
  }
  yield { type: "finish", data: {} as TextGenerationTaskOutput };
};

export const Ollama_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  OllamaModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  const client = getClient(model);
  const modelName = getModelName(model);

  const stream = await client.chat({
    model: modelName,
    messages: [
      { role: "system", content: input.prompt },
      { role: "user", content: input.text },
    ],
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.message.content;
    if (delta) {
      yield { type: "text-delta", textDelta: delta };
    }
  }
  yield { type: "finish", data: {} as TextRewriterTaskOutput };
};

export const Ollama_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  OllamaModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
  const client = getClient(model);
  const modelName = getModelName(model);

  const stream = await client.chat({
    model: modelName,
    messages: [
      { role: "system", content: "Summarize the following text concisely." },
      { role: "user", content: input.text },
    ],
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.message.content;
    if (delta) {
      yield { type: "text-delta", textDelta: delta };
    }
  }
  yield { type: "finish", data: {} as TextSummaryTaskOutput };
};

// ========================================================================
// Task registries
// ========================================================================

export const OLLAMA_TASKS: Record<string, AiProviderRunFn<any, any, OllamaModelConfig>> = {
  TextGenerationTask: Ollama_TextGeneration,
  TextEmbeddingTask: Ollama_TextEmbedding,
  TextRewriterTask: Ollama_TextRewriter,
  TextSummaryTask: Ollama_TextSummary,
};

export const OLLAMA_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, OllamaModelConfig>
> = {
  TextGenerationTask: Ollama_TextGeneration_Stream,
  TextRewriterTask: Ollama_TextRewriter_Stream,
  TextSummaryTask: Ollama_TextSummary_Stream,
};
