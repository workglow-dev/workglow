/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FunctionCallingMode, TaskType } from "@google/generative-ai";
import type {
  AiProviderReactiveRunFn,
  AiProviderRunFn,
  AiProviderStreamFn,
  CountTokensTaskInput,
  CountTokensTaskOutput,
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
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
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolDefinition,
} from "@workglow/ai";
import { buildToolDescription, filterValidToolCalls } from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger, parsePartialJson } from "@workglow/util";
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

interface ResolvedProviderConfig {
  readonly credential_key?: string;
  readonly api_key?: string;
  readonly model_name?: string;
  readonly embedding_task_type?: string | null;
}

function getApiKey(model: GeminiModelConfig | undefined): string {
  const config = model?.provider_config as ResolvedProviderConfig | undefined;
  const apiKey =
    config?.credential_key ||
    config?.api_key ||
    (typeof process !== "undefined"
      ? process.env?.GOOGLE_API_KEY || process.env?.GEMINI_API_KEY
      : undefined);
  if (!apiKey) {
    throw new Error(
      "Missing Google API key: set provider_config.credential_key or the GOOGLE_API_KEY / GEMINI_API_KEY environment variable."
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
  if (Array.isArray(input.prompt)) {
    getLogger().warn(
      "Gemini_TextGeneration: array input received; processing sequentially (no native batch support)"
    );
    const prompts = input.prompt as string[];
    const results: string[] = [];
    for (const item of prompts) {
      const r = await Gemini_TextGeneration({ ...input, prompt: item }, model, update_progress, signal);
      results.push(r.text as string);
    }
    return { text: results };
  }

  const logger = getLogger();
  const timerLabel = `gemini:TextGeneration:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });

  update_progress(0, "Starting Gemini text generation");
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    generationConfig: {
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
      topP: input.topP,
    },
  });

  const result = await genModel.generateContent({
    contents: [{ role: "user", parts: [{ text: input.prompt as string }] }],
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
  const genAI = new GoogleGenerativeAI(getApiKey(model));
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
    content: { role: "user", parts: [{ text: input.text as string }] },
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
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "Gemini_TextRewriter: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const results: string[] = [];
    for (const item of texts) {
      const r = await Gemini_TextRewriter({ ...input, text: item }, model, update_progress, signal);
      results.push(r.text as string);
    }
    return { text: results };
  }

  update_progress(0, "Starting Gemini text rewriting");
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    systemInstruction: input.prompt as string,
  });

  const result = await genModel.generateContent({
    contents: [{ role: "user", parts: [{ text: input.text as string }] }],
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
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "Gemini_TextSummary: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const results: string[] = [];
    for (const item of texts) {
      const r = await Gemini_TextSummary({ ...input, text: item }, model, update_progress, signal);
      results.push(r.text as string);
    }
    return { text: results };
  }

  update_progress(0, "Starting Gemini text summarization");
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    systemInstruction: "Summarize the following text concisely.",
  });

  const result = await genModel.generateContent({
    contents: [{ role: "user", parts: [{ text: input.text as string }] }],
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
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    generationConfig: {
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
      topP: input.topP,
    },
  });

  const result = await genModel.generateContentStream(
    { contents: [{ role: "user", parts: [{ text: input.prompt as string }] }] },
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
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    systemInstruction: input.prompt as string,
  });

  const result = await genModel.generateContentStream(
    { contents: [{ role: "user", parts: [{ text: input.text as string }] }] },
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
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    systemInstruction: "Summarize the following text concisely.",
  });

  const result = await genModel.generateContentStream(
    { contents: [{ role: "user", parts: [{ text: input.text as string }] }] },
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
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "Gemini_CountTokens: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const counts: number[] = [];
    for (const item of texts) {
      const r = await Gemini_CountTokens({ ...input, text: item }, model, onProgress, signal);
      counts.push(r.count as number);
    }
    return { count: counts };
  }

  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));
  const genModel = genAI.getGenerativeModel({ model: getModelName(model) });
  const result = await genModel.countTokens(input.text as string);
  return { count: result.totalTokens };
};

export const Gemini_CountTokens_Reactive: AiProviderReactiveRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  GeminiModelConfig
> = async (input, _output, _model) => {
  return { count: Math.ceil((input.text as string).length / 4) };
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
  const genAI = new GoogleGenerativeAI(getApiKey(model));

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
    contents: [{ role: "user", parts: [{ text: input.prompt as string }] }],
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
  const genAI = new GoogleGenerativeAI(getApiKey(model));

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
    { contents: [{ role: "user", parts: [{ text: input.prompt as string }] }] },
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
// Tool calling implementations
// ========================================================================

function mapGeminiToolConfig(
  toolChoice: string | undefined
):
  | { functionCallingConfig: { mode: FunctionCallingMode; allowedFunctionNames?: string[] } }
  | undefined {
  if (!toolChoice || toolChoice === "auto") {
    return { functionCallingConfig: { mode: "AUTO" as FunctionCallingMode } };
  }
  if (toolChoice === "none") {
    return { functionCallingConfig: { mode: "NONE" as FunctionCallingMode } };
  }
  if (toolChoice === "required") {
    return { functionCallingConfig: { mode: "ANY" as FunctionCallingMode } };
  }
  // Specific tool name
  return {
    functionCallingConfig: {
      mode: "ANY" as FunctionCallingMode,
      allowedFunctionNames: [toolChoice],
    },
  };
}

export const Gemini_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  GeminiModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.prompt)) {
    getLogger().warn(
      "Gemini_ToolCalling: array input received; processing sequentially (no native batch support)"
    );
    const prompts = input.prompt as string[];
    const texts: string[] = [];
    const toolCallsList: Record<string, unknown>[] = [];
    for (const item of prompts) {
      const r = await Gemini_ToolCalling({ ...input, prompt: item }, model, update_progress, signal);
      texts.push(r.text as string);
      toolCallsList.push(r.toolCalls as Record<string, unknown>);
    }
    return { text: texts, toolCalls: toolCallsList };
  }

  update_progress(0, "Starting Gemini tool calling");
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));

  const functionDeclarations = input.tools.map((t: ToolDefinition) => ({
    name: t.name,
    description: buildToolDescription(t),
    parameters: t.inputSchema as any,
  }));

  const toolConfig = mapGeminiToolConfig(input.toolChoice);

  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    tools: [{ functionDeclarations }],
    toolConfig: toolConfig as any,
    systemInstruction: input.systemPrompt || undefined,
    generationConfig: {
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
    },
  });

  const result = await genModel.generateContent({
    contents: [{ role: "user", parts: [{ text: input.prompt as string }] }],
  });

  const parts = result.response.candidates?.[0]?.content?.parts ?? [];

  const textParts: string[] = [];
  const toolCalls: Record<string, unknown> = {};
  let callIndex = 0;

  for (const part of parts) {
    if ("text" in part && part.text) {
      textParts.push(part.text);
    }
    if ("functionCall" in part && part.functionCall) {
      const id = `call_${callIndex++}`;
      toolCalls[id] = {
        id,
        name: part.functionCall.name,
        input: (part.functionCall.args as Record<string, unknown>) ?? {},
      };
    }
  }

  update_progress(100, "Completed Gemini tool calling");
  return { text: textParts.join(""), toolCalls: filterValidToolCalls(toolCalls, input.tools) };
};

export const Gemini_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  GeminiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  const GoogleGenerativeAI = await loadGeminiSDK();
  const genAI = new GoogleGenerativeAI(getApiKey(model));

  const functionDeclarations = input.tools.map((t: ToolDefinition) => ({
    name: t.name,
    description: buildToolDescription(t),
    parameters: t.inputSchema as any,
  }));

  const toolConfig = mapGeminiToolConfig(input.toolChoice);

  const genModel = genAI.getGenerativeModel({
    model: getModelName(model),
    tools: [{ functionDeclarations }],
    toolConfig: toolConfig as any,
    systemInstruction: input.systemPrompt || undefined,
    generationConfig: {
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
    },
  });

  const result = await genModel.generateContentStream(
    { contents: [{ role: "user", parts: [{ text: input.prompt as string }] }] },
    { signal }
  );

  let accumulatedText = "";
  const toolCalls: Record<string, unknown> = {};
  let callIndex = 0;

  for await (const chunk of result.stream) {
    const parts = chunk.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if ("text" in part && part.text) {
        accumulatedText += part.text;
        yield { type: "text-delta", port: "text", textDelta: part.text };
      }
      if ("functionCall" in part && part.functionCall) {
        const id = `call_${callIndex++}`;
        toolCalls[id] = {
          id,
          name: part.functionCall.name,
          input: (part.functionCall.args as Record<string, unknown>) ?? {},
        };
        yield { type: "object-delta", port: "toolCalls", objectDelta: { ...toolCalls } };
      }
    }
  }

  const validToolCalls = filterValidToolCalls(toolCalls, input.tools);
  yield {
    type: "finish",
    data: { text: accumulatedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
  };
};

// ========================================================================
// Model info
// ========================================================================

export const Gemini_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  GeminiModelConfig
> = async (input) => {
  return {
    model: input.model,
    is_local: false,
    is_remote: true,
    supports_browser: true,
    supports_node: true,
    is_cached: false,
    is_loaded: false,
    file_sizes: null,
  };
};

// ========================================================================
// Task registries
// ========================================================================

export const GEMINI_TASKS: Record<string, AiProviderRunFn<any, any, GeminiModelConfig>> = {
  CountTokensTask: Gemini_CountTokens,
  ModelInfoTask: Gemini_ModelInfo,
  TextGenerationTask: Gemini_TextGeneration,
  TextEmbeddingTask: Gemini_TextEmbedding,
  TextRewriterTask: Gemini_TextRewriter,
  TextSummaryTask: Gemini_TextSummary,
  StructuredGenerationTask: Gemini_StructuredGeneration,
  ToolCallingTask: Gemini_ToolCalling,
};

export const GEMINI_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, GeminiModelConfig>
> = {
  TextGenerationTask: Gemini_TextGeneration_Stream,
  TextRewriterTask: Gemini_TextRewriter_Stream,
  TextSummaryTask: Gemini_TextSummary_Stream,
  StructuredGenerationTask: Gemini_StructuredGeneration_Stream,
  ToolCallingTask: Gemini_ToolCalling_Stream,
};

export const GEMINI_REACTIVE_TASKS: Record<
  string,
  AiProviderReactiveRunFn<any, any, GeminiModelConfig>
> = {
  CountTokensTask: Gemini_CountTokens_Reactive,
};
