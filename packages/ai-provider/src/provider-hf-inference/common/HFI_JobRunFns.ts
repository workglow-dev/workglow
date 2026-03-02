/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { InferenceProviderOrPolicy } from "@huggingface/inference";
import { buildToolDescription, filterValidToolCalls, toOpenAIMessages } from "@workglow/ai";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
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
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger, parsePartialJson } from "@workglow/util";
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

interface ResolvedProviderConfig {
  readonly credential_key?: string;
  readonly api_key?: string;
  readonly model_name?: string;
  readonly provider?: string;
}

async function getClient(model: HfInferenceModelConfig | undefined) {
  const sdk = await loadHfInferenceSDK();
  const config = model?.provider_config as ResolvedProviderConfig | undefined;
  const apiKey =
    config?.credential_key ||
    config?.api_key ||
    (typeof process !== "undefined" ? process.env?.HF_TOKEN : undefined);
  if (!apiKey) {
    throw new Error(
      "Missing Hugging Face API key: set provider_config.credential_key or the HF_TOKEN environment variable."
    );
  }
  return new sdk.InferenceClient(apiKey);
}

function getModelName(model: HfInferenceModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

function getProvider(
  model: HfInferenceModelConfig | undefined
): InferenceProviderOrPolicy | undefined {
  return model?.provider_config?.provider as InferenceProviderOrPolicy | undefined;
}

export const HFI_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  HfInferenceModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.prompt)) {
    getLogger().warn(
      "HFI_TextGeneration: array input received; processing sequentially (no native batch support)"
    );
    const prompts = input.prompt as string[];
    const results: string[] = [];
    for (const item of prompts) {
      const r = await HFI_TextGeneration(
        { ...input, prompt: item },
        model,
        update_progress,
        signal
      );
      results.push(r.text as string);
    }
    return { text: results };
  }

  const logger = getLogger();
  const timerLabel = `hfi:TextGeneration:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });

  update_progress(0, "Starting HF Inference text generation");
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const response = await client.chatCompletion(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt as string }],
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      frequency_penalty: input.frequencyPenalty,
      provider,
    },
    { signal }
  );

  update_progress(100, "Completed HF Inference text generation");
  logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name });
  return { text: response.choices[0]?.message?.content ?? "" };
};

export const HFI_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  HfInferenceModelConfig
> = async (input, model, update_progress, signal) => {
  const logger = getLogger();
  const timerLabel = `hfi:TextEmbedding:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });

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
    logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name, batch: true });
    return {
      vector: embeddings.map((embedding) => new Float32Array(embedding as unknown as number[])),
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
  logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name });
  return { vector: new Float32Array(embedding as unknown as number[]) };
};

export const HFI_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  HfInferenceModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "HFI_TextRewriter: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const results: string[] = [];
    for (const item of texts) {
      const r = await HFI_TextRewriter({ ...input, text: item }, model, update_progress, signal);
      results.push(r.text as string);
    }
    return { text: results };
  }

  update_progress(0, "Starting HF Inference text rewriting");
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const response = await client.chatCompletion(
    {
      model: modelName,
      messages: [
        { role: "system", content: input.prompt as string },
        { role: "user", content: input.text as string },
      ],
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
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "HFI_TextSummary: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const results: string[] = [];
    for (const item of texts) {
      const r = await HFI_TextSummary({ ...input, text: item }, model, update_progress, signal);
      results.push(r.text as string);
    }
    return { text: results };
  }

  update_progress(0, "Starting HF Inference text summarization");
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const response = await client.chatCompletion(
    {
      model: modelName,
      messages: [
        { role: "system", content: "Summarize the following text concisely." },
        { role: "user", content: input.text as string },
      ],
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
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const stream = client.chatCompletionStream(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt as string }],
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      frequency_penalty: input.frequencyPenalty,
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
        { role: "system", content: input.prompt as string },
        { role: "user", content: input.text as string },
      ],
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
        { role: "user", content: input.text as string },
      ],
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
// Tool calling implementations
// ========================================================================

function mapHFIToolChoice(
  toolChoice: string | undefined
): "auto" | "none" | "required" | undefined {
  if (!toolChoice || toolChoice === "auto") return "auto";
  if (toolChoice === "none") return "none";
  if (toolChoice === "required") return "required";
  // Specific tool names are not supported by HF Inference; fall back to "auto"
  return "auto";
}

export const HFI_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  HfInferenceModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.prompt)) {
    getLogger().warn(
      "HFI_ToolCalling: array input received; processing sequentially (no native batch support)"
    );
    const prompts = input.prompt as string[];
    const texts: string[] = [];
    const toolCallsList: Record<string, unknown>[] = [];
    for (const item of prompts) {
      const r = await HFI_ToolCalling({ ...input, prompt: item }, model, update_progress, signal);
      texts.push(r.text as string);
      toolCallsList.push(r.toolCalls as Record<string, unknown>);
    }
    return { text: texts, toolCalls: toolCallsList };
  }

  update_progress(0, "Starting HF Inference tool calling");
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const tools = input.tools.map((t: ToolDefinition) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: buildToolDescription(t),
      parameters: t.inputSchema as any,
    },
  }));

  const messages = toOpenAIMessages(input);

  const toolChoice = mapHFIToolChoice(input.toolChoice);

  const params: any = {
    model: modelName,
    messages,
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    provider,
  };

  if (toolChoice !== "none") {
    params.tools = tools;
    params.tool_choice = toolChoice;
  }

  const response = await client.chatCompletion(params, { signal });

  const text = response.choices[0]?.message?.content ?? "";
  const toolCalls: Record<string, unknown> = {};
  let callIndex = 0;
  ((response.choices[0]?.message as any)?.tool_calls ?? []).forEach((tc: any) => {
    let parsedInput: Record<string, unknown> = {};
    const rawArgs = tc.function?.arguments;
    if (typeof rawArgs === "string") {
      try {
        parsedInput = JSON.parse(rawArgs);
      } catch {
        const partial = parsePartialJson(rawArgs);
        parsedInput = (partial as Record<string, unknown>) ?? {};
      }
    } else if (rawArgs != null) {
      parsedInput = rawArgs as Record<string, unknown>;
    }
    const id = (tc.id as string) ?? `call_${callIndex}`;
    callIndex++;
    toolCalls[id] = { id, name: tc.function.name as string, input: parsedInput };
  });

  update_progress(100, "Completed HF Inference tool calling");
  return { text, toolCalls: filterValidToolCalls(toolCalls, input.tools) };
};

export const HFI_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  HfInferenceModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);
  const provider = getProvider(model);

  const tools = input.tools.map((t: ToolDefinition) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: buildToolDescription(t),
      parameters: t.inputSchema as any,
    },
  }));

  const messages = toOpenAIMessages(input);

  const toolChoice = mapHFIToolChoice(input.toolChoice);

  const params: any = {
    model: modelName,
    messages,
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    provider,
  };

  if (toolChoice !== "none") {
    params.tools = tools;
    params.tool_choice = toolChoice;
  }

  const stream = client.chatCompletionStream(params, { signal });

  let accumulatedText = "";
  const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    const contentDelta = choice.delta?.content ?? "";
    if (contentDelta) {
      accumulatedText += contentDelta;
      yield { type: "text-delta", port: "text", textDelta: contentDelta };
    }

    const tcDeltas = (choice.delta as any)?.tool_calls;
    if (Array.isArray(tcDeltas)) {
      for (const tcDelta of tcDeltas) {
        const idx = tcDelta.index as number;
        if (!toolCallAccumulator.has(idx)) {
          toolCallAccumulator.set(idx, {
            id: tcDelta.id ?? "",
            name: tcDelta.function?.name ?? "",
            arguments: "",
          });
        }
        const acc = toolCallAccumulator.get(idx)!;
        if (tcDelta.id) acc.id = tcDelta.id;
        if (tcDelta.function?.name) acc.name = tcDelta.function.name;
        if (tcDelta.function?.arguments) acc.arguments += tcDelta.function.arguments;
      }

      const snapshotObject: Record<string, unknown> = {};
      Array.from(toolCallAccumulator.entries()).forEach(([idx, tc]) => {
        let parsedInput: Record<string, unknown>;
        try {
          parsedInput = JSON.parse(tc.arguments);
        } catch {
          const partial = parsePartialJson(tc.arguments);
          parsedInput = (partial as Record<string, unknown>) ?? {};
        }
        const key = tc.id || String(idx);
        snapshotObject[key] = { id: tc.id, name: tc.name, input: parsedInput };
      });
      yield { type: "object-delta", port: "toolCalls", objectDelta: snapshotObject };
    }
  }

  const toolCalls: Record<string, unknown> = {};
  Array.from(toolCallAccumulator.entries()).forEach(([idx, tc]) => {
    let finalInput: Record<string, unknown>;
    try {
      finalInput = JSON.parse(tc.arguments);
    } catch {
      finalInput = (parsePartialJson(tc.arguments) as Record<string, unknown>) ?? {};
    }
    const key = tc.id || String(idx);
    toolCalls[key] = { id: tc.id, name: tc.name, input: finalInput };
  });

  const validToolCalls = filterValidToolCalls(toolCalls, input.tools);
  yield {
    type: "finish",
    data: { text: accumulatedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
  };
};

// ========================================================================
// Model info
// ========================================================================

export const HFI_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  HfInferenceModelConfig
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

export const HFI_TASKS: Record<string, AiProviderRunFn<any, any, HfInferenceModelConfig>> = {
  ModelInfoTask: HFI_ModelInfo,
  TextGenerationTask: HFI_TextGeneration,
  TextEmbeddingTask: HFI_TextEmbedding,
  TextRewriterTask: HFI_TextRewriter,
  TextSummaryTask: HFI_TextSummary,
  ToolCallingTask: HFI_ToolCalling,
};

export const HFI_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, HfInferenceModelConfig>
> = {
  TextGenerationTask: HFI_TextGeneration_Stream,
  TextRewriterTask: HFI_TextRewriter_Stream,
  TextSummaryTask: HFI_TextSummary_Stream,
  ToolCallingTask: HFI_ToolCalling_Stream,
};
