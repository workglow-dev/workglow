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
import type { HfInferenceModelConfig } from "./HFI_ModelSchema";

let _sdk: typeof import("@huggingface/inference") | undefined;
async function loadHfInferenceSDK() {
  if (!_sdk) {
    try {
      _sdk = await import("@huggingface/inference");
    } catch {
      throw new Error(
        "@huggingface/inference is required for Hugging Face Inference tasks. Install it with: bun add @huggingface/inference"
      );
    }
  }
  return _sdk;
}

async function getClient(model: HfInferenceModelConfig | undefined) {
  const sdk = await loadHfInferenceSDK();
  const apiKey =
    model?.provider_config?.api_key ||
    (typeof process !== "undefined" ? process.env?.HF_TOKEN : undefined);
  if (!apiKey) {
    throw new Error(
      "Missing Hugging Face API key: set provider_config.api_key or the HF_TOKEN environment variable."
    );
  }
  return new sdk.HfInference(apiKey);
}

function getModelName(model: HfInferenceModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

function getProvider(model: HfInferenceModelConfig | undefined): string | undefined {
  return model?.provider_config?.provider;
}

export const HFI_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  HfInferenceModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting HF Inference text generation");
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const response = await client.chatCompletion(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      frequency_penalty: input.frequencyPenalty,
      // @ts-ignore - provider is an optional field specific to HF Inference
      provider,
    },
    { signal }
  );

  update_progress(100, "Completed HF Inference text generation");
  return { text: response.choices[0]?.message?.content ?? "" };
};

export const HFI_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  HfInferenceModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting HF Inference text embedding");
  const client = await getClient(model);
  const modelName = getModelName(model);

  if (Array.isArray(input.text)) {
    const embeddings = await Promise.all(
      input.text.map((text) =>
        client.featureExtraction(
          {
            model: modelName,
            inputs: text,
          },
          { signal }
        )
      )
    );

    update_progress(100, "Completed HF Inference text embedding");
    return {
      vector: embeddings.map((embedding) => new Float32Array(embedding as number[])),
    };
  }

  const embedding = await client.featureExtraction(
    {
      model: modelName,
      inputs: input.text,
    },
    { signal }
  );

  update_progress(100, "Completed HF Inference text embedding");
  return { vector: new Float32Array(embedding as number[]) };
};

export const HFI_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  HfInferenceModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting HF Inference text rewriting");
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const response = await client.chatCompletion(
    {
      model: modelName,
      messages: [
        { role: "system", content: input.prompt },
        { role: "user", content: input.text },
      ],
      // @ts-ignore - provider is an optional field specific to HF Inference
      provider,
    },
    { signal }
  );

  update_progress(100, "Completed HF Inference text rewriting");
  return { text: response.choices[0]?.message?.content ?? "" };
};

export const HFI_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  HfInferenceModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting HF Inference text summarization");
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const response = await client.chatCompletion(
    {
      model: modelName,
      messages: [
        { role: "system", content: "Summarize the following text concisely." },
        { role: "user", content: input.text },
      ],
      // @ts-ignore - provider is an optional field specific to HF Inference
      provider,
    },
    { signal }
  );

  update_progress(100, "Completed HF Inference text summarization");
  return { text: response.choices[0]?.message?.content ?? "" };
};

// ========================================================================
// Streaming implementations (append mode)
// ========================================================================

export const HFI_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  HfInferenceModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const stream = client.chatCompletionStream(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      frequency_penalty: input.frequencyPenalty,
      // @ts-ignore - provider is an optional field specific to HF Inference
      provider,
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

export const HFI_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  HfInferenceModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const stream = client.chatCompletionStream(
    {
      model: modelName,
      messages: [
        { role: "system", content: input.prompt },
        { role: "user", content: input.text },
      ],
      // @ts-ignore - provider is an optional field specific to HF Inference
      provider,
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

export const HFI_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  HfInferenceModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const stream = client.chatCompletionStream(
    {
      model: modelName,
      messages: [
        { role: "system", content: "Summarize the following text concisely." },
        { role: "user", content: input.text },
      ],
      // @ts-ignore - provider is an optional field specific to HF Inference
      provider,
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

export const HFI_TASKS: Record<string, AiProviderRunFn<any, any, HfInferenceModelConfig>> = {
  TextGenerationTask: HFI_TextGeneration,
  TextEmbeddingTask: HFI_TextEmbedding,
  TextRewriterTask: HFI_TextRewriter,
  TextSummaryTask: HFI_TextSummary,
};

export const HFI_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, HfInferenceModelConfig>
> = {
  TextGenerationTask: HFI_TextGeneration_Stream,
  TextRewriterTask: HFI_TextRewriter_Stream,
  TextSummaryTask: HFI_TextSummary_Stream,
};
