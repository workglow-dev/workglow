/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskType } from "@google/generative-ai";
import type {
  AiProviderReactiveRunFn,
  AiProviderRunFn,
  AiProviderStreamFn,
  CountTokensTaskInput,
  CountTokensTaskOutput,
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
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
import { getLogger, parsePartialJson, resolveCredential } from "@workglow/util";
import type { GeminiModelConfig } from "./Gemini_ModelSchema";

let _sdk: typeof import("@google/generative-ai") | undefined;
async function loadGeminiSDK() {
  if (!_sdk) {
    try {
      _sdk = await import("@google/generative-ai");
    } catch {
      throw new Error(
        "@google/generative-ai is required for Gemini tasks. Install it with: bun add @google/generative-ai"
      );
    }
  }
  return _sdk.GoogleGenerativeAI;
}

async function getApiKey(model: GeminiModelConfig | undefined): Promise<string> {
  // Resolution order: credential store → explicit api_key → environment variable
  const credentialKey = model?.provider_config?.credential_key;
  const storedCredential = credentialKey ? await resolveCredential(credentialKey) : undefined;

  const apiKey =
    storedCredential ??
    model?.provider_config?.api_key ??
    (typeof process !== "undefined"
      ? process.env?.GOOGLE_API_KEY ?? process.env?.GEMINI_API_KEY
      : undefined);
  if (!apiKey) {
    throw new Error(
      "Missing Google API key: set provider_config.credential_key, provider_config.api_key, or the GOOGLE_API_KEY / GEMINI_API_KEY environment variable."
    );
  }
  return apiKey;
}

function getModelName(model: GeminiModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

export const Gemini_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  GeminiModelConfig
> = async (input, model, update_progress, signal) => {
  const logger = getLogger();
  const timerLabel = `gemini:TextGeneration:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });

  update_progress(0, "Starting Gemini text generation");
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(await getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    generationConfig: {
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
      topP: input.topP,
    },
  });

  const result = await genModel.generateContent({
    contents: [{ role: "user", parts: [{ text: input.prompt }] }],
  });

  const text = result.response.text();
  update_progress(100, "Completed Gemini text generation");
  logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name });
  return { text };
};

export const Gemini_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  GeminiModelConfig
> = async (input, model, update_progress, signal) => {
  const logger = getLogger();
  const timerLabel = `gemini:TextEmbedding:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });

  update_progress(0, "Starting Gemini text embedding");
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(await getApiKey(model));
  const embeddingModel = genAI.getGenerativeModel({
    model: getModelName(model),
  });

  const taskType =
    (model?.provider_config?.embedding_task_type as TaskType) || ("RETRIEVAL_DOCUMENT" as TaskType);

  if (Array.isArray(input.text)) {
    const result = await embeddingModel.batchEmbedContents({
      requests: input.text.map((t) => ({
        content: { role: "user", parts: [{ text: t }] },
        taskType,
      })),
    });
    update_progress(100, "Completed Gemini text embedding");
    logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name, batch: true });
    return {
      vector: result.embeddings.map((e) => new Float32Array(e.values)),
    };
  }

  const result = await embeddingModel.embedContent({
    content: { role: "user", parts: [{ text: input.text }] },
    taskType,
  });

  update_progress(100, "Completed Gemini text embedding");
  logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name });
  return { vector: new Float32Array(result.embedding.values) };
};

export const Gemini_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  GeminiModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Gemini text rewriting");
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(await getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    systemInstruction: input.prompt,
  });

  const result = await genModel.generateContent({
    contents: [{ role: "user", parts: [{ text: input.text }] }],
  });

  const text = result.response.text();
  update_progress(100, "Completed Gemini text rewriting");
  return { text };
};

export const Gemini_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  GeminiModelConfig
> = async (input, model, update_progress, signal) => {
  update_progress(0, "Starting Gemini text summarization");
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(await getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    systemInstruction: "Summarize the following text concisely.",
  });

  const result = await genModel.generateContent({
    contents: [{ role: "user", parts: [{ text: input.text }] }],
  });

  const text = result.response.text();
  update_progress(100, "Completed Gemini text summarization");
  return { text };
};

// ========================================================================
// Streaming implementations (append mode)
// ========================================================================

export const Gemini_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  GeminiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(await getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    generationConfig: {
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
      topP: input.topP,
    },
  });

  const result = await genModel.generateContentStream(
    { contents: [{ role: "user", parts: [{ text: input.prompt }] }] },
    { signal }
  );

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      yield { type: "text-delta", port: "text", textDelta: text };
    }
  }
  yield { type: "finish", data: {} as TextGenerationTaskOutput };
};

export const Gemini_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  GeminiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(await getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    systemInstruction: input.prompt,
  });

  const result = await genModel.generateContentStream(
    { contents: [{ role: "user", parts: [{ text: input.text }] }] },
    { signal }
  );

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      yield { type: "text-delta", port: "text", textDelta: text };
    }
  }
  yield { type: "finish", data: {} as TextRewriterTaskOutput };
};

export const Gemini_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  GeminiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(await getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    systemInstruction: "Summarize the following text concisely.",
  });

  const result = await genModel.generateContentStream(
    { contents: [{ role: "user", parts: [{ text: input.text }] }] },
    { signal }
  );

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      yield { type: "text-delta", port: "text", textDelta: text };
    }
  }
  yield { type: "finish", data: {} as TextSummaryTaskOutput };
};

export const Gemini_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  GeminiModelConfig
> = async (input, model, onProgress, signal) => {
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(await getApiKey(model));
  const genModel = genAI.getGenerativeModel({ model: getModelName(model) });
  const result = await genModel.countTokens(input.text);
  return { count: result.totalTokens };
};

export const Gemini_CountTokens_Reactive: AiProviderReactiveRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  GeminiModelConfig
> = async (input, _output, _model) => {
  return { count: Math.ceil(input.text.length / 4) };
};

// ========================================================================
// Structured output implementations (object mode)
// ========================================================================

export const Gemini_StructuredGeneration: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  GeminiModelConfig
> = async (input, model, update_progress, signal, outputSchema) => {
  update_progress(0, "Starting Gemini structured generation");
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(await getApiKey(model));

  const schema = input.outputSchema ?? outputSchema;

  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema as any,
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
    },
  });

  const result = await genModel.generateContent({
    contents: [{ role: "user", parts: [{ text: input.prompt }] }],
  });

  const text = result.response.text();
  update_progress(100, "Completed Gemini structured generation");
  return { object: JSON.parse(text) };
};

export const Gemini_StructuredGeneration_Stream: AiProviderStreamFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  GeminiModelConfig
> = async function* (
  input,
  model,
  signal,
  outputSchema
): AsyncIterable<StreamEvent<StructuredGenerationTaskOutput>> {
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(await getApiKey(model));

  const schema = input.outputSchema ?? outputSchema;

  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema as any,
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
    },
  });

  const result = await genModel.generateContentStream(
    { contents: [{ role: "user", parts: [{ text: input.prompt }] }] },
    { signal }
  );

  let accumulatedJson = "";
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      accumulatedJson += text;
      const partial = parsePartialJson(accumulatedJson);
      if (partial !== undefined) {
        yield { type: "object-delta", port: "object", objectDelta: partial };
      }
    }
  }

  let finalObject: Record<string, unknown>;
  try {
    finalObject = JSON.parse(accumulatedJson);
  } catch {
    finalObject = parsePartialJson(accumulatedJson) ?? {};
  }
  yield { type: "finish", data: { object: finalObject } as StructuredGenerationTaskOutput };
};

// ========================================================================
// Task registries
// ========================================================================

export const GEMINI_TASKS: Record<string, AiProviderRunFn<any, any, GeminiModelConfig>> = {
  CountTokensTask: Gemini_CountTokens,
  TextGenerationTask: Gemini_TextGeneration,
  TextEmbeddingTask: Gemini_TextEmbedding,
  TextRewriterTask: Gemini_TextRewriter,
  TextSummaryTask: Gemini_TextSummary,
  StructuredGenerationTask: Gemini_StructuredGeneration,
};

export const GEMINI_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, GeminiModelConfig>
> = {
  TextGenerationTask: Gemini_TextGeneration_Stream,
  TextRewriterTask: Gemini_TextRewriter_Stream,
  TextSummaryTask: Gemini_TextSummary_Stream,
  StructuredGenerationTask: Gemini_StructuredGeneration_Stream,
};

export const GEMINI_REACTIVE_TASKS: Record<
  string,
  AiProviderReactiveRunFn<any, any, GeminiModelConfig>
> = {
  CountTokensTask: Gemini_CountTokens_Reactive,
};
