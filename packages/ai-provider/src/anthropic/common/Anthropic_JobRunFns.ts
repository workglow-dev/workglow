/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildToolDescription, filterValidToolCalls } from "@workglow/ai";
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
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";

let _sdk: typeof import("@anthropic-ai/sdk") | undefined;
async function loadAnthropicSDK() {
  if (!_sdk) {
    try {
      _sdk = await import("@anthropic-ai/sdk");
    } catch {
      throw new Error(
        "@anthropic-ai/sdk is required for Anthropic tasks. Install it with: bun add @anthropic-ai/sdk"
      );
    }
  }
  return _sdk.default;
}

interface ResolvedProviderConfig {
  readonly credential_key?: string;
  readonly api_key?: string;
  readonly model_name?: string;
  readonly base_url?: string;
  readonly max_tokens?: number;
}

async function getClient(model: AnthropicModelConfig | undefined) {
  const Anthropic = await loadAnthropicSDK();
  const config = model?.provider_config as ResolvedProviderConfig | undefined;
  const apiKey =
    config?.credential_key ||
    config?.api_key ||
    (typeof process !== "undefined" ? process.env?.ANTHROPIC_API_KEY : undefined);
  if (!apiKey) {
    throw new Error(
      "Missing Anthropic API key: set provider_config.credential_key or the ANTHROPIC_API_KEY environment variable."
    );
  }
  return new Anthropic({
    apiKey,
    baseURL: config?.base_url || undefined,
    dangerouslyAllowBrowser: true,
  });
}

function getModelName(model: AnthropicModelConfig | undefined): string {
  const name = model?.provider_config?.model_name;
  if (!name) {
    throw new Error("Missing model name in provider_config.model_name.");
  }
  return name;
}

function getMaxTokens(
  input: { maxTokens?: number },
  model: AnthropicModelConfig | undefined
): number {
  return input.maxTokens ?? model?.provider_config?.max_tokens ?? 1024;
}

export const Anthropic_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.prompt)) {
    getLogger().warn(
      "Anthropic_TextGeneration: array input received; processing sequentially (no native batch support)"
    );
    const prompts = input.prompt as string[];
    const results: string[] = [];
    for (const item of prompts) {
      const r = await Anthropic_TextGeneration(
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
  const timerLabel = `anthropic:TextGeneration:${model?.provider_config?.model_name}`;
  logger.time(timerLabel, { model: model?.provider_config?.model_name });

  update_progress(0, "Starting Anthropic text generation");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const response = await client.messages.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt as string }],
      max_tokens: getMaxTokens(input, model),
      temperature: input.temperature,
      top_p: input.topP,
    },
    { signal }
  );

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  update_progress(100, "Completed Anthropic text generation");
  logger.timeEnd(timerLabel, { model: model?.provider_config?.model_name });
  return { text };
};

export const Anthropic_TextRewriter: AiProviderRunFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "Anthropic_TextRewriter: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const results: string[] = [];
    for (const item of texts) {
      const r = await Anthropic_TextRewriter(
        { ...input, text: item },
        model,
        update_progress,
        signal
      );
      results.push(r.text as string);
    }
    return { text: results };
  }

  update_progress(0, "Starting Anthropic text rewriting");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const response = await client.messages.create(
    {
      model: modelName,
      system: input.prompt as string,
      messages: [{ role: "user", content: input.text as string }],
      max_tokens: getMaxTokens({}, model),
    },
    { signal }
  );

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  update_progress(100, "Completed Anthropic text rewriting");
  return { text };
};

export const Anthropic_TextSummary: AiProviderRunFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "Anthropic_TextSummary: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const results: string[] = [];
    for (const item of texts) {
      const r = await Anthropic_TextSummary(
        { ...input, text: item },
        model,
        update_progress,
        signal
      );
      results.push(r.text as string);
    }
    return { text: results };
  }

  update_progress(0, "Starting Anthropic text summarization");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const response = await client.messages.create(
    {
      model: modelName,
      system: "Summarize the following text concisely.",
      messages: [{ role: "user", content: input.text as string }],
      max_tokens: getMaxTokens({}, model),
    },
    { signal }
  );

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  update_progress(100, "Completed Anthropic text summarization");
  return { text };
};

// ========================================================================
// Streaming implementations (append mode)
// ========================================================================

export const Anthropic_TextGeneration_Stream: AiProviderStreamFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  AnthropicModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextGenerationTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const stream = client.messages.stream(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt as string }],
      max_tokens: getMaxTokens(input, model),
      temperature: input.temperature,
      top_p: input.topP,
    },
    { signal }
  );

  let accumulatedText = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      accumulatedText += event.delta.text;
      yield { type: "text-delta", port: "text", textDelta: event.delta.text };
    }
  }
  yield { type: "finish", data: { text: accumulatedText } as TextGenerationTaskOutput };
};

export const Anthropic_TextRewriter_Stream: AiProviderStreamFn<
  TextRewriterTaskInput,
  TextRewriterTaskOutput,
  AnthropicModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextRewriterTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const stream = client.messages.stream(
    {
      model: modelName,
      system: input.prompt as string,
      messages: [{ role: "user", content: input.text as string }],
      max_tokens: getMaxTokens({}, model),
    },
    { signal }
  );

  let accumulatedText = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      accumulatedText += event.delta.text;
      yield { type: "text-delta", port: "text", textDelta: event.delta.text };
    }
  }
  yield { type: "finish", data: { text: accumulatedText } as TextRewriterTaskOutput };
};

export const Anthropic_TextSummary_Stream: AiProviderStreamFn<
  TextSummaryTaskInput,
  TextSummaryTaskOutput,
  AnthropicModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<TextSummaryTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const stream = client.messages.stream(
    {
      model: modelName,
      system: "Summarize the following text concisely.",
      messages: [{ role: "user", content: input.text as string }],
      max_tokens: getMaxTokens({}, model),
    },
    { signal }
  );

  let accumulatedText = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      accumulatedText += event.delta.text;
      yield { type: "text-delta", port: "text", textDelta: event.delta.text };
    }
  }
  yield { type: "finish", data: { text: accumulatedText } as TextSummaryTaskOutput };
};

export const Anthropic_CountTokens: AiProviderRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  AnthropicModelConfig
> = async (input, model, onProgress, signal) => {
  if (Array.isArray(input.text)) {
    getLogger().warn(
      "Anthropic_CountTokens: array input received; processing sequentially (no native batch support)"
    );
    const texts = input.text as string[];
    const counts: number[] = [];
    for (const item of texts) {
      const r = await Anthropic_CountTokens({ ...input, text: item }, model, onProgress, signal);
      counts.push(r.count as number);
    }
    return { count: counts };
  }

  const client = await getClient(model);
  const result = await client.messages.countTokens({
    model: getModelName(model),
    messages: [{ role: "user", content: input.text as string }],
  });
  return { count: result.input_tokens };
};

export const Anthropic_CountTokens_Reactive: AiProviderReactiveRunFn<
  CountTokensTaskInput,
  CountTokensTaskOutput,
  AnthropicModelConfig
> = async (input, _output, _model) => {
  return { count: Math.ceil((input.text as string).length / 4) };
};

// ========================================================================
// Structured output implementations (object mode)
// ========================================================================

export const Anthropic_StructuredGeneration: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal, outputSchema) => {
  update_progress(0, "Starting Anthropic structured generation");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const schema = input.outputSchema ?? outputSchema;

  const response = await client.messages.create(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt as string }],
      tools: [
        {
          name: "structured_output",
          description: "Output structured data conforming to the schema",
          input_schema: schema as any,
        },
      ],
      tool_choice: { type: "tool" as const, name: "structured_output" },
      max_tokens: getMaxTokens(input, model),
    },
    { signal }
  );

  const toolBlock = response.content.find((b: any) => b.type === "tool_use") as any;
  const object = toolBlock?.input ?? {};

  update_progress(100, "Completed Anthropic structured generation");
  return { object };
};

export const Anthropic_StructuredGeneration_Stream: AiProviderStreamFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  AnthropicModelConfig
> = async function* (
  input,
  model,
  signal,
  outputSchema
): AsyncIterable<StreamEvent<StructuredGenerationTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const schema = input.outputSchema ?? outputSchema;

  const stream = client.messages.stream(
    {
      model: modelName,
      messages: [{ role: "user", content: input.prompt as string }],
      tools: [
        {
          name: "structured_output",
          description: "Output structured data conforming to the schema",
          input_schema: schema as any,
        },
      ],
      tool_choice: { type: "tool" as const, name: "structured_output" },
      max_tokens: getMaxTokens(input, model),
    },
    { signal }
  );

  let accumulatedJson = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && (event.delta as any).type === "input_json_delta") {
      accumulatedJson += (event.delta as any).partial_json;
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

/**
 * Build Anthropic-format messages from the task input.
 * When `input.messages` is present (multi-turn agent loop), converts the
 * provider-agnostic ChatMessage format to Anthropic's message format.
 * Otherwise falls back to a single user message from `input.prompt`.
 */
function mapUserContentToAnthropic(content: unknown): any {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content;
  const parts: any[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      parts.push({
        type: "image",
        source: {
          type: "base64",
          media_type: block.mimeType as string,
          data: block.data as string,
        },
      });
    }
    // Audio is not natively supported by Anthropic — skip
  }
  return parts;
}

function mapToolResultContentToAnthropic(content: unknown): any {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content;
  const parts: any[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      parts.push({
        type: "image",
        source: {
          type: "base64",
          media_type: block.mimeType as string,
          data: block.data as string,
        },
      });
    }
  }
  return parts;
}

function buildAnthropicMessages(input: ToolCallingTaskInput): any[] {
  const inputMessages = input.messages;
  if (!inputMessages || inputMessages.length === 0) {
    return [{ role: "user", content: input.prompt }];
  }

  const messages: any[] = [];
  for (const msg of inputMessages) {
    if (msg.role === "user") {
      messages.push({ role: "user", content: mapUserContentToAnthropic(msg.content) });
    } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const blocks = msg.content.map((block: any) => {
        if (block.type === "text") return { type: "text", text: block.text };
        if (block.type === "tool_use") {
          return { type: "tool_use", id: block.id, name: block.name, input: block.input };
        }
        return block;
      });
      messages.push({ role: "assistant", content: blocks });
    } else if (msg.role === "tool" && Array.isArray(msg.content)) {
      // Anthropic expects tool results as role: "user" with tool_result content blocks
      const blocks = msg.content.map((block: any) => ({
        type: "tool_result",
        tool_use_id: block.tool_use_id,
        content: mapToolResultContentToAnthropic(block.content),
        ...(block.is_error && { is_error: true }),
      }));
      messages.push({ role: "user", content: blocks });
    }
  }
  return messages;
}

function mapAnthropicToolChoice(
  toolChoice: string | undefined
): { type: "auto" } | { type: "any" } | { type: "tool"; name: string } | undefined {
  if (!toolChoice || toolChoice === "auto") return { type: "auto" };
  if (toolChoice === "none") return undefined;
  if (toolChoice === "required") return { type: "any" };
  return { type: "tool", name: toolChoice };
}

export const Anthropic_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  AnthropicModelConfig
> = async (input, model, update_progress, signal) => {
  if (Array.isArray(input.prompt)) {
    getLogger().warn(
      "Anthropic_ToolCalling: array input received; processing sequentially (no native batch support)"
    );
    const prompts = input.prompt as string[];
    const texts: string[] = [];
    const toolCallsList: Record<string, unknown>[] = [];
    for (const item of prompts) {
      const r = await Anthropic_ToolCalling(
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

  update_progress(0, "Starting Anthropic tool calling");
  const client = await getClient(model);
  const modelName = getModelName(model);

  const tools = input.tools.map((t: ToolDefinition) => ({
    name: t.name,
    description: buildToolDescription(t),
    input_schema: t.inputSchema as any,
  }));

  const toolChoice = mapAnthropicToolChoice(input.toolChoice);

  const messages = buildAnthropicMessages(input);

  const params: any = {
    model: modelName,
    messages,
    max_tokens: getMaxTokens(input, model),
    temperature: input.temperature,
  };

  if (input.systemPrompt) {
    params.system = input.systemPrompt;
  }

  // "none" means don't send tools at all
  if (toolChoice !== undefined) {
    params.tools = tools;
    params.tool_choice = toolChoice;
  }

  const response = await client.messages.create(params, { signal });

  const text = response.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  const toolCalls: Record<string, unknown> = {};
  response.content
    .filter((b: any) => b.type === "tool_use")
    .forEach((b: any) => {
      const id = b.id as string;
      toolCalls[id] = {
        id,
        name: b.name as string,
        input: (b.input as Record<string, unknown>) ?? {},
      };
    });

  update_progress(100, "Completed Anthropic tool calling");
  return { text, toolCalls: filterValidToolCalls(toolCalls, input.tools) };
};

export const Anthropic_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  AnthropicModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  const client = await getClient(model);
  const modelName = getModelName(model);

  const tools = input.tools.map((t: ToolDefinition) => ({
    name: t.name,
    description: buildToolDescription(t),
    input_schema: t.inputSchema as any,
  }));

  const toolChoice = mapAnthropicToolChoice(input.toolChoice);

  const messages = buildAnthropicMessages(input);

  const params: any = {
    model: modelName,
    messages,
    max_tokens: getMaxTokens(input, model),
    temperature: input.temperature,
  };

  if (input.systemPrompt) {
    params.system = input.systemPrompt;
  }

  if (toolChoice !== undefined) {
    params.tools = tools;
    params.tool_choice = toolChoice;
  }

  const stream = client.messages.stream(params, { signal });

  // Track content blocks by index
  const blockMeta = new Map<number, { type: string; id?: string; name?: string; json: string }>();
  let accumulatedText = "";
  const toolCalls: Record<string, unknown> = {};

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      const block = (event as any).content_block;
      const index = (event as any).index as number;
      if (block.type === "tool_use") {
        blockMeta.set(index, {
          type: "tool_use",
          id: block.id,
          name: block.name,
          json: "",
        });
      } else if (block.type === "text") {
        blockMeta.set(index, { type: "text", json: "" });
      }
    } else if (event.type === "content_block_delta") {
      const index = (event as any).index as number;
      const delta = event.delta as any;
      if (delta.type === "text_delta") {
        accumulatedText += delta.text;
        yield { type: "text-delta", port: "text", textDelta: delta.text };
      } else if (delta.type === "input_json_delta") {
        const meta = blockMeta.get(index);
        if (meta) {
          meta.json += delta.partial_json;
          // Parse accumulated JSON for this tool call and yield progressive update
          let parsedInput: Record<string, unknown>;
          try {
            parsedInput = JSON.parse(meta.json);
          } catch {
            const partial = parsePartialJson(meta.json);
            parsedInput = (partial as Record<string, unknown>) ?? {};
          }
          // Build current tool calls snapshot as Record keyed by id
          const snapshotObject: Record<string, unknown> = {
            ...toolCalls,
            [meta.id ?? ""]: { id: meta.id ?? "", name: meta.name ?? "", input: parsedInput },
          };
          yield { type: "object-delta", port: "toolCalls", objectDelta: snapshotObject };
        }
      }
    } else if (event.type === "content_block_stop") {
      const index = (event as any).index as number;
      const meta = blockMeta.get(index);
      if (meta?.type === "tool_use") {
        let finalInput: Record<string, unknown>;
        try {
          finalInput = JSON.parse(meta.json);
        } catch {
          finalInput = (parsePartialJson(meta.json) as Record<string, unknown>) ?? {};
        }
        const id = meta.id ?? "";
        toolCalls[id] = { id, name: meta.name ?? "", input: finalInput };
        yield { type: "object-delta", port: "toolCalls", objectDelta: { ...toolCalls } };
      }
      blockMeta.delete(index);
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

export const Anthropic_ModelInfo: AiProviderRunFn<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  AnthropicModelConfig
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

export const ANTHROPIC_TASKS: Record<string, AiProviderRunFn<any, any, AnthropicModelConfig>> = {
  CountTokensTask: Anthropic_CountTokens,
  ModelInfoTask: Anthropic_ModelInfo,
  TextGenerationTask: Anthropic_TextGeneration,
  TextRewriterTask: Anthropic_TextRewriter,
  TextSummaryTask: Anthropic_TextSummary,
  StructuredGenerationTask: Anthropic_StructuredGeneration,
  ToolCallingTask: Anthropic_ToolCalling,
};

export const ANTHROPIC_STREAM_TASKS: Record<
  string,
  AiProviderStreamFn<any, any, AnthropicModelConfig>
> = {
  TextGenerationTask: Anthropic_TextGeneration_Stream,
  TextRewriterTask: Anthropic_TextRewriter_Stream,
  TextSummaryTask: Anthropic_TextSummary_Stream,
  StructuredGenerationTask: Anthropic_StructuredGeneration_Stream,
  ToolCallingTask: Anthropic_ToolCalling_Stream,
};

export const ANTHROPIC_REACTIVE_TASKS: Record<
  string,
  AiProviderReactiveRunFn<any, any, AnthropicModelConfig>
> = {
  CountTokensTask: Anthropic_CountTokens_Reactive,
};
