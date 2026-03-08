/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildToolDescription, filterValidToolCalls, toOpenAIMessages } from "@workglow/ai";
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
import type { StreamEvent } from "@workglow/task-graph";
import { getLogger, parsePartialJson } from "@workglow/util";
import type { OpenAiModelConfig } from "./OpenAI_ModelSchema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _OpenAIClass: (new (config: any) => any) | undefined;
async function loadOpenAISDK() {
  if (!_OpenAIClass) {
    try {
      const sdk = await import("openai");
      _OpenAIClass = sdk.default;
    } catch {
      throw new Error("openai is required for OpenAI tasks. Install it with: bun add openai");
    }
  }
  return _OpenAIClass;
}

interface ResolvedProviderConfig {
  readonly credential_key?: string;
  readonly api_key?: string;
  readonly model_name?: string;
  readonly base_url?: string;
  readonly organization?: string;
}

async function getClient(model: OpenAiModelConfig | undefined) {
  const OpenAI = await loadOpenAISDK();
  const config = model?.provider_config as ResolvedProviderConfig | undefined;
  const apiKey =
    config?.credential_key ||
    config?.api_key ||
    (typeof process !== "undefined" ? process.env?.OPENAI_API_KEY : undefined);
  if (!apiKey) {
    throw new Error(
      "Missing OpenAI API key: set provider_config.credential_key or the OPENAI_API_KEY environment variable."
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: config?.base_url || undefined,
    organization: config?.organization || undefined,
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
  if (Array.isArray(input.prompt)) {
    getLogger().warn(
      "OpenAI_TextGeneration: array input received; processing sequentially (no native batch support)"
    );
    const prompts = input.prompt as string[];
    const results: string[] = [];
    for (const item of prompts) {
      const r = await OpenAI_TextGeneration(
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
  const timerLabel = `openai:TextGeneration:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });

  update_progress(0, "Starting OpenAI text generation");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const response = await client.chat.completions.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt as string }],
      max_completion_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      frequency_penalty: input.frequencyPenalty,
      presence_penalty: input.presencePenalty,
    },
    { signal }
  );

  update_progress(100, "Completed OpenAI text generation");
  logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name });
  return { text: response.choices[0]?.message?.content ?? "" };
};

export const OpenAI_TextEmbedding: AiProviderRunFn<
  TextEmbeddingTaskInput,
  TextEmbeddingTaskOutput,
  OpenAiModelConfig
> = async (input, model, update_progress, signal) => {
  const logger = getLogger();
  const timerLabel = `openai:TextEmbedding:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });

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
  logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name });

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
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "OpenAI_TextRewriter: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const results: string[] = [];
    for (const item of texts) {
      const r = await OpenAI_TextRewriter({ ...input, text: item }, model, update_progress, signal);
      results.push(r.text as string);
    }
    return { text: results };
  }

  update_progress(0, "Starting OpenAI text rewriting");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const response = await client.chat.completions.create(
    {
      model: modelName,
      messages: [
        { role: "system", content: input.prompt as string },
        { role: "user", content: input.text as string },
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
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "OpenAI_TextSummary: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const results: string[] = [];
    for (const item of texts) {
      const r = await OpenAI_TextSummary({ ...input, text: item }, model, update_progress, signal);
      results.push(r.text as string);
    }
    return { text: results };
  }

  update_progress(0, "Starting OpenAI text summarization");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const response = await client.chat.completions.create(
    {
      model: modelName,
      messages: [
        { role: "system", content: "Summarize the following text concisely." },
        { role: "user", content: input.text as string },
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
      messages: [{ role: "user", content: input.prompt as string }],
      max_completion_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      frequency_penalty: input.frequencyPenalty,
      presence_penalty: input.presencePenalty,
      stream: true,
    },
    { signal }
  );

  let accumulatedText = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      accumulatedText += delta;
      yield { type: "text-delta", port: "text", textDelta: delta };
    }
  }
  yield { type: "finish", data: { text: accumulatedText } as TextGenerationTaskOutput };
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
        { role: "system", content: input.prompt as string },
        { role: "user", content: input.text as string },
      ],
      stream: true,
    },
    { signal }
  );

  let accumulatedText = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      accumulatedText += delta;
      yield { type: "text-delta", port: "text", textDelta: delta };
    }
  }
  yield { type: "finish", data: { text: accumulatedText } as TextRewriterTaskOutput };
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
        { role: "user", content: input.text as string },
      ],
      stream: true,
    },
    { signal }
  );

  let accumulatedText = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      accumulatedText += delta;
      yield { type: "text-delta", port: "text", textDelta: delta };
    }
  }
  yield { type: "finish", data: { text: accumulatedText } as TextSummaryTaskOutput };
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
export function _setTiktokenForTesting(mod: typeof import("tiktoken") | undefined): void {
  _tiktoken = mod;
  _encoderCache.clear();
}

async function getEncoder(modelName: string) {
  const tiktoken = await loadTiktoken();
  if (!_encoderCache.has(modelName)) {
    try {
      _encoderCache.set(
        modelName,
        tiktoken.encoding_for_model(modelName as Parameters<typeof tiktoken.encoding_for_model>[0])
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
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "OpenAI_CountTokens: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const counts: number[] = [];
    for (const item of texts) {
      const r = await OpenAI_CountTokens(
        { ...input, text: item },
        model,
        () => {},
        new AbortController().signal
      );
      counts.push(r.count as number);
    }
    return { count: counts };
  }

  const enc = await getEncoder(getModelName(model));
  const tokens = enc.encode(input.text as string);
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
// Structured output implementations (object mode)
// ========================================================================

export const OpenAI_StructuredGeneration: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  OpenAiModelConfig
> = async (input, model, update_progress, signal, outputSchema) => {
  update_progress(0, "Starting OpenAI structured generation");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const schema = input.outputSchema ?? outputSchema;

  const response = await client.chat.completions.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      response_format: {
        type: "json_schema" as any,
        json_schema: {
          name: "structured_output",
          schema: schema,
          strict: true,
        },
      } as any,
      max_completion_tokens: input.maxTokens,
      temperature: input.temperature,
    },
    { signal }
  );

  const content = response.choices[0]?.message?.content ?? "{}";
  update_progress(100, "Completed OpenAI structured generation");
  return { object: JSON.parse(content) };
};

export const OpenAI_StructuredGeneration_Stream: AiProviderStreamFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  OpenAiModelConfig
> = async function* (
  input,
  model,
  signal,
  outputSchema
): AsyncIterable<StreamEvent<StructuredGenerationTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const schema = input.outputSchema ?? outputSchema;

  const stream = await client.chat.completions.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt }],
      response_format: {
        type: "json_schema" as any,
        json_schema: {
          name: "structured_output",
          schema: schema,
          strict: true,
        },
      } as any,
      max_completion_tokens: input.maxTokens,
      temperature: input.temperature,
      stream: true,
    },
    { signal }
  );

  let accumulatedJson = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      accumulatedJson += delta;
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

function mapOpenAIToolChoice(
  toolChoice: string | undefined
): "auto" | "none" | "required" | { type: "function"; function: { name: string } } | undefined {
  if (!toolChoice || toolChoice === "auto") return "auto";
  if (toolChoice === "none") return "none";
  if (toolChoice === "required") return "required";
  return { type: "function", function: { name: toolChoice } };
}

export const OpenAI_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  OpenAiModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.prompt)) {
    getLogger().warn(
      "OpenAI_ToolCalling: array input received; processing sequentially (no native batch support)"
    );
    const prompts = input.prompt as string[];
    const texts: string[] = [];
    const toolCallsList: Record<string, unknown>[] = [];
    for (const item of prompts) {
      const r = await OpenAI_ToolCalling(
        { ...input, prompt: item },
        model,
        update_progress,
        signal
      );
      texts.push(r.text as string);
      toolCallsList.push(r.toolCalls as Record<string, unknown>);
    }
    return { text: texts, toolCalls: toolCallsList };
  }

  update_progress(0, "Starting OpenAI tool calling");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const tools = input.tools.map((t: ToolDefinition) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: buildToolDescription(t),
      parameters: t.inputSchema as any,
    },
  }));

  const messages = toOpenAIMessages(input) as any[];

  const toolChoice = mapOpenAIToolChoice(input.toolChoice);

  const params: any = {
    model: modelName,
    messages,
    max_completion_tokens: input.maxTokens,
    temperature: input.temperature,
  };

  // "none" means still send tools but prevent selection
  if (toolChoice !== undefined) {
    params.tools = tools;
    params.tool_choice = toolChoice;
  }

  const response = await client.chat.completions.create(params, { signal });

  const text = response.choices[0]?.message?.content ?? "";
  const toolCalls: Record<string, unknown> = {};
  for (const tc of response.choices[0]?.message?.tool_calls ?? []) {
    if (!("function" in tc)) continue;
    const id = tc.id as string;
    const name = tc.function.name as string;
    let input: Record<string, unknown> = {};
    const rawArgs = tc.function.arguments;
    if (typeof rawArgs === "string") {
      try {
        input = JSON.parse(rawArgs) as Record<string, unknown>;
      } catch {
        try {
          const partial = parsePartialJson(rawArgs);
          if (partial && typeof partial === "object") {
            input = partial as Record<string, unknown>;
          }
        } catch {
          input = {};
        }
      }
    }
    toolCalls[id] = { id, name, input };
  }

  update_progress(100, "Completed OpenAI tool calling");
  return { text, toolCalls: filterValidToolCalls(toolCalls, input.tools) };
};

export const OpenAI_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  OpenAiModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const tools = input.tools.map((t: ToolDefinition) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: buildToolDescription(t),
      parameters: t.inputSchema as any,
    },
  }));

  const messages = toOpenAIMessages(input) as any[];

  const toolChoice = mapOpenAIToolChoice(input.toolChoice);

  const stream = await client.chat.completions.create(
    {
      model: modelName,
      messages,
      max_completion_tokens: input.maxTokens,
      temperature: input.temperature,
      stream: true,
      ...(toolChoice !== undefined ? { tools, tool_choice: toolChoice } : {}),
    },
    { signal }
  );

  let accumulatedText = "";
  // Track tool calls by index: { id, name, arguments (accumulated string) }
  const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    // Text content
    const contentDelta = choice.delta?.content ?? "";
    if (contentDelta) {
      accumulatedText += contentDelta;
      yield { type: "text-delta", port: "text", textDelta: contentDelta };
    }

    // Tool call deltas
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

      // Yield progressive snapshot of all tool calls as Record keyed by id
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

  // Build final tool calls as Record keyed by id
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

export const OpenAI_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  OpenAiModelConfig
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

export const OPENAI_TASKS: Record<string, AiProviderRunFn<any, any, OpenAiModelConfig>> = {
  TextGenerationTask: OpenAI_TextGeneration,
  ModelInfoTask: OpenAI_ModelInfo,
  TextEmbeddingTask: OpenAI_TextEmbedding,
  TextRewriterTask: OpenAI_TextRewriter,
  TextSummaryTask: OpenAI_TextSummary,
  CountTokensTask: OpenAI_CountTokens,
  StructuredGenerationTask: OpenAI_StructuredGeneration,
  ToolCallingTask: OpenAI_ToolCalling,
};

export const OPENAI_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, OpenAiModelConfig>
> = {
  TextGenerationTask: OpenAI_TextGeneration_Stream,
  TextRewriterTask: OpenAI_TextRewriter_Stream,
  TextSummaryTask: OpenAI_TextSummary_Stream,
  StructuredGenerationTask: OpenAI_StructuredGeneration_Stream,
  ToolCallingTask: OpenAI_ToolCalling_Stream,
};

export const OPENAI_REACTIVE_TASKS: Record<
  string,
  AiProviderReactiveRunFn<any, any, OpenAiModelConfig>
> = {
  CountTokensTask: OpenAI_CountTokens_Reactive,
};
