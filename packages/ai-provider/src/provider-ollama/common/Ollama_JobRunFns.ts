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
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolDefinition,
} from "@workglow/ai";
import { buildToolDescription, filterValidToolCalls } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { parsePartialJson } from "@workglow/util";
import { OLLAMA_DEFAULT_BASE_URL } from "./Ollama_Constants";
import type { OllamaModelConfig } from "./Ollama_ModelSchema";

let _sdk: typeof import("ollama") | undefined;
async function loadOllamaSDK() {
  if (!_sdk) {
    try {
      _sdk = await import("ollama");
    } catch {
      throw new Error("ollama is required for Ollama tasks. Install it with: bun add ollama");
    }
  }
  return _sdk.Ollama;
}

async function getClient(model: OllamaModelConfig | undefined) {
  const Ollama = await loadOllamaSDK();
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
  const client = await getClient(model);
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
  const client = await getClient(model);
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
  const client = await getClient(model);
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
  const client = await getClient(model);
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
  const client = await getClient(model);
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

  const onAbort = () => stream.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const chunk of stream) {
      const delta = chunk.message.content;
      if (delta) {
        yield { type: "text-delta", port: "text", textDelta: delta };
      }
    }
    yield { type: "finish", data: {} as TextGenerationTaskOutput };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
};

export const Ollama_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  OllamaModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const stream = await client.chat({
    model: modelName,
    messages: [
      { role: "system", content: input.prompt },
      { role: "user", content: input.text },
    ],
    stream: true,
  });

  const onAbort = () => stream.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const chunk of stream) {
      const delta = chunk.message.content;
      if (delta) {
        yield { type: "text-delta", port: "text", textDelta: delta };
      }
    }
    yield { type: "finish", data: {} as TextRewriterTaskOutput };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
};

export const Ollama_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  OllamaModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const stream = await client.chat({
    model: modelName,
    messages: [
      { role: "system", content: "Summarize the following text concisely." },
      { role: "user", content: input.text },
    ],
    stream: true,
  });

  const onAbort = () => stream.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const chunk of stream) {
      const delta = chunk.message.content;
      if (delta) {
        yield { type: "text-delta", port: "text", textDelta: delta };
      }
    }
    yield { type: "finish", data: {} as TextSummaryTaskOutput };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
};

// ========================================================================
// Tool calling implementations
// ========================================================================

function mapOllamaTools(tools: ReadonlyArray<ToolDefinition>) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: buildToolDescription(t),
      parameters: t.inputSchema as any,
    },
  }));
}

export const Ollama_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  OllamaModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Ollama tool calling");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const messages: Array<{ role: string; content: string }> = [];
  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt });
  }
  messages.push({ role: "user", content: input.prompt });

  const tools = input.toolChoice === "none" ? undefined : mapOllamaTools(input.tools);

  const response = await client.chat({
    model: modelName,
    messages,
    tools,
    options: {
      temperature: input.temperature,
      num_predict: input.maxTokens,
    },
  });

  const text = response.message.content ?? "";
  const toolCalls: Record<string, unknown> = {};
  (response.message.tool_calls ?? []).forEach((tc: any, index: number) => {
    let parsedInput: Record<string, unknown> = {};
    const fnArgs = tc.function.arguments;
    if (typeof fnArgs === "string") {
      try {
        parsedInput = JSON.parse(fnArgs);
      } catch {
        const partial = parsePartialJson(fnArgs);
        parsedInput = (partial as Record<string, unknown>) ?? {};
      }
    } else if (fnArgs != null) {
      parsedInput = fnArgs as Record<string, unknown>;
    }
    const id = `call_${index}`;
    toolCalls[id] = { id, name: tc.function.name as string, input: parsedInput };
  });

  update_progress(100, "Completed Ollama tool calling");
  return { text, toolCalls: filterValidToolCalls(toolCalls, input.tools) };
};

export const Ollama_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  OllamaModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const messages: Array<{ role: string; content: string }> = [];
  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt });
  }
  messages.push({ role: "user", content: input.prompt });

  const tools = input.toolChoice === "none" ? undefined : mapOllamaTools(input.tools);

  const stream = await client.chat({
    model: modelName,
    messages,
    tools,
    options: {
      temperature: input.temperature,
      num_predict: input.maxTokens,
    },
    stream: true,
  });

  const onAbort = () => stream.abort();
  signal.addEventListener("abort", onAbort, { once: true });

  let accumulatedText = "";
  const toolCalls: Record<string, unknown> = {};
  let callIndex = 0;

  try {
    for await (const chunk of stream) {
      const delta = chunk.message.content;
      if (delta) {
        accumulatedText += delta;
        yield { type: "text-delta", port: "text", textDelta: delta };
      }

      const chunkToolCalls = (chunk.message as any).tool_calls;
      if (Array.isArray(chunkToolCalls) && chunkToolCalls.length > 0) {
        for (const tc of chunkToolCalls) {
          let parsedInput: Record<string, unknown> = {};
          const fnArgs = tc.function.arguments;
          if (typeof fnArgs === "string") {
            try {
              parsedInput = JSON.parse(fnArgs);
            } catch {
              const partial = parsePartialJson(fnArgs);
              parsedInput = (partial as Record<string, unknown>) ?? {};
            }
          } else if (fnArgs != null) {
            parsedInput = fnArgs as Record<string, unknown>;
          }
          const id = `call_${callIndex++}`;
          toolCalls[id] = { id, name: tc.function.name as string, input: parsedInput };
        }
        yield { type: "object-delta", port: "toolCalls", objectDelta: { ...toolCalls } };
      }
    }

    const validToolCalls = filterValidToolCalls(toolCalls, input.tools);
    yield {
      type: "finish",
      data: { text: accumulatedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
    };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
};

// ========================================================================
// Task registries
// ========================================================================

export const OLLAMA_TASKS: Record<string, AiProviderRunFn<any, any, OllamaModelConfig>> = {
  TextGenerationTask: Ollama_TextGeneration,
  TextEmbeddingTask: Ollama_TextEmbedding,
  TextRewriterTask: Ollama_TextRewriter,
  TextSummaryTask: Ollama_TextSummary,
  ToolCallingTask: Ollama_ToolCalling,
};

export const OLLAMA_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, OllamaModelConfig>
> = {
  TextGenerationTask: Ollama_TextGeneration_Stream,
  TextRewriterTask: Ollama_TextRewriter_Stream,
  TextSummaryTask: Ollama_TextSummary_Stream,
  ToolCallingTask: Ollama_ToolCalling_Stream,
};
