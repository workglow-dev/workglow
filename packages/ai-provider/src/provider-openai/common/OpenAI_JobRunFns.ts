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
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

let _sdk: typeof import("openai") | undefined;
async function loadOpenAISDK() {
  if (!_sdk) {
    try {
      _sdk = await import("openai");
    } catch {
      throw new Error("openai is required for OpenAI tasks. Install it with: bun add openai");
    }
  }
  return _sdk.default;
}

async function getClient(model: OpenAiModelConfig | undefined) {
  const OpenAI = await loadOpenAISDK();
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

  update_progress(100, "Completed OpenAI text generation");
  return { text: response.choices[0]?.message?.content ?? "" };
};

export const OpenAI_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  OpenAiModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting OpenAI text embedding");
  const client = await getClient(model);
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

  update_progress(100, "Completed OpenAI text rewriting");
  return { text: response.choices[0]?.message?.content ?? "" };
};

export const OpenAI_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  OpenAiModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting OpenAI text summarization");
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

export const OpenAI_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  OpenAiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
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

export const OpenAI_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  OpenAiModelConfig
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
// Token counting via tiktoken (local, no API call)
// ========================================================================

let _tiktoken: typeof import("tiktoken") | undefined;
async function loadTiktoken() {
  if (!_tiktoken) {
    try {
      _tiktoken = await import("tiktoken");
    } catch {
      throw new Error(
        "tiktoken is required for OpenAI token counting. Install it with: bun add tiktoken"
      );
    }
  }
  return _tiktoken;
}

// Cache encoders by model name to avoid repeated allocation overhead.
const _encoderCache = new Map<string, ReturnType<typeof import("tiktoken").get_encoding>>();

/**
 * @internal Test-only hook: inject a mock tiktoken module and clear the encoder cache.
 * Needed because `vi.mock("tiktoken")` cannot intercept the dynamic `import("tiktoken")`
 * that lives inside `loadTiktoken()` when running under vitest.
 */
export function _setTiktokenForTesting(
  mod: typeof import("tiktoken") | undefined
): void {
  _tiktoken = mod;
  _encoderCache.clear();
}

async function getEncoder(modelName: string) {
  const tiktoken = await loadTiktoken();
  if (!_encoderCache.has(modelName)) {
    try {
      _encoderCache.set(
        modelName,
        tiktoken.encoding_for_model(
          modelName as Parameters<typeof tiktoken.encoding_for_model>[0]
        )
      );
    } catch {
      // Fall back to cl100k_base for unknown/newer models.
      const fallback = "cl100k_base";
      if (!_encoderCache.has(fallback)) {
        _encoderCache.set(fallback, tiktoken.get_encoding(fallback));
      }
      _encoderCache.set(modelName, _encoderCache.get(fallback)!);
    }
  }
  return _encoderCache.get(modelName)!;
}

export const OpenAI_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  OpenAiModelConfig
> = async (input, model) => {
  const enc = await getEncoder(getModelName(model));
  const tokens = enc.encode(input.text);
  return { count: tokens.length };
};

export const OpenAI_CountTokens_Reactive: AiProviderReactiveRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  OpenAiModelConfig
> = async (input, _output, model) => {
  return OpenAI_CountTokens(input, model, () => {}, new AbortController().signal);
};

// ========================================================================
// Task registries
// ========================================================================

export const OPENAI_TASKS: Record<string, AiProviderRunFn<any, any, OpenAiModelConfig>> = {
  TextGenerationTask: OpenAI_TextGeneration,
  TextEmbeddingTask: OpenAI_TextEmbedding,
  TextRewriterTask: OpenAI_TextRewriter,
  TextSummaryTask: OpenAI_TextSummary,
  CountTokensTask: OpenAI_CountTokens,
};

export const OPENAI_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, OpenAiModelConfig>
> = {
  TextGenerationTask: OpenAI_TextGeneration_Stream,
  TextRewriterTask: OpenAI_TextRewriter_Stream,
  TextSummaryTask: OpenAI_TextSummary_Stream,
};

export const OPENAI_REACTIVE_TASKS: Record<
  string,
  AiProviderReactiveRunFn<any, any, OpenAiModelConfig>
> = {
  CountTokensTask: OpenAI_CountTokens_Reactive,
};
