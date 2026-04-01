/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tensor, TextGenerationPipeline } from "@huggingface/transformers";
import {
  buildToolDescription,
  filterValidToolCalls,
  toTextFlatMessages,
} from "@workglow/ai/worker";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolCalls,
  ToolDefinition,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { HfTransformersOnnxModelConfig } from "./HFT_ModelSchema";
import { getPipeline, loadTransformersSDK } from "./HFT_Pipeline";
import {
  createStreamEventQueue,
  createStreamingTextStreamer,
  createTextStreamer,
} from "./HFT_Streaming";
import { createToolCallMarkupFilter } from "./HFT_ToolMarkup";
import {
  getAvailableParsers,
  getGenerationPrefix,
  parseToolCalls,
  stripModelArtifacts,
} from "./HFT_ToolParser";

// ============================================================================
// Model detection
// ============================================================================

function getModelTextCandidates(model: HfTransformersOnnxModelConfig): string[] {
  return [model.model_id, model.title, model.description, model.provider_config.model_path]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => value.toLowerCase());
}

/**
 * Detect the parser model family from the HFT model config by checking all
 * text candidates against the known parser families.
 */
function detectModelFamilyFromConfig(model: HfTransformersOnnxModelConfig): string | null {
  const candidates = getModelTextCandidates(model);
  const families = getAvailableParsers();
  for (const candidate of candidates) {
    for (const family of families) {
      if (candidate.includes(family)) {
        return family;
      }
    }
  }
  return null;
}

// ============================================================================
// Tool call result adaptation
// ============================================================================

/**
 * Convert a parser result (using `arguments` field) to the workglow `ToolCalls`
 * type (using `input` field).
 */
function adaptParserResult(result: ReturnType<typeof parseToolCalls>): {
  text: string;
  toolCalls: ToolCalls;
} {
  return {
    text: stripModelArtifacts(result.content),
    toolCalls: result.tool_calls.map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.name,
      input: call.arguments as Record<string, unknown>,
    })),
  };
}

function forcedToolSelection(input: ToolCallingTaskInput): string | undefined {
  if (
    typeof input.toolChoice === "string" &&
    input.toolChoice !== "auto" &&
    input.toolChoice !== "none"
  ) {
    if (input.toolChoice !== "required") {
      return input.toolChoice;
    }
  }
  if (input.toolChoice === "required" && input.tools.length === 1) {
    return input.tools[0]?.name;
  }
  return undefined;
}

function normalizeParsedToolCalls(
  input: ToolCallingTaskInput,
  toolCalls: ToolCallingTaskOutput["toolCalls"]
) {
  const forcedToolName = forcedToolSelection(input);
  return toolCalls.map((toolCall) =>
    toolCall.name
      ? toolCall
      : {
          ...toolCall,
          name: forcedToolName ?? toolCall.name,
        }
  );
}

// ============================================================================
// HFT tool mapping
// ============================================================================

function mapHFTTools(tools: ReadonlyArray<ToolDefinition>) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: buildToolDescription(t),
      parameters: t.inputSchema as any,
    },
  }));
}

/**
 * Resolve the tools list and optionally mutate the messages array based on the toolChoice option.
 */
function resolveHFTToolsAndMessages(
  input: ToolCallingTaskInput,
  messages: Array<{ role: string; content: string }>
): ReturnType<typeof mapHFTTools> | undefined {
  if (input.toolChoice === "none") {
    return undefined;
  }

  if (input.toolChoice === "required") {
    const requiredInstruction =
      "You must call at least one tool from the provided tool list when answering.";
    if (messages.length > 0 && messages[0].role === "system") {
      messages[0] = { ...messages[0], content: `${messages[0].content}\n\n${requiredInstruction}` };
    } else {
      messages.unshift({ role: "system", content: requiredInstruction });
    }
    return mapHFTTools(input.tools);
  }

  if (typeof input.toolChoice === "string" && input.toolChoice !== "auto") {
    const selectedTools = input.tools?.filter(
      (tool: ToolDefinition) => tool.name === input.toolChoice
    );
    const toolsToMap = selectedTools && selectedTools.length > 0 ? selectedTools : input.tools;
    return mapHFTTools(toolsToMap);
  }

  return mapHFTTools(input.tools);
}

// ============================================================================
// HFT message building
// ============================================================================

/**
 * Extract text from a content block that may be a string, array of content
 * blocks, or other structure.
 */
function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return String(content ?? "");
  }
  return content
    .filter(
      (block) =>
        block && typeof block === "object" && (block as { type?: unknown }).type === "text"
    )
    .map((block) => String((block as { text?: unknown }).text ?? ""))
    .join("");
}

/**
 * Try to parse a string as JSON; return the raw string if it's not valid JSON.
 * Used for tool result content which may be a JSON-encoded value.
 */
function parsePossibleToolResponse(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall back to the raw string.
    }
  }
  return content;
}

/**
 * Build structured messages for HFT's `apply_chat_template`.
 *
 * Unlike `toTextFlatMessages` (which flattens everything to `{role, content}`
 * strings), this preserves tool_calls on assistant messages and the tool name
 * on tool-result messages — both required by HFT chat templates that support
 * tool calling.
 */
function buildHFTMessages(input: ToolCallingTaskInput): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];

  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt });
  }

  if (input.toolChoice === "required") {
    const instruction =
      "You must call at least one tool from the provided tool list when answering.";
    if (messages.length > 0 && messages[0].role === "system") {
      messages[0] = {
        ...messages[0],
        content: `${messages[0].content as string}\n\n${instruction}`,
      };
    } else {
      messages.unshift({ role: "system", content: instruction });
    }
  }

  const sourceMessages =
    input.messages && input.messages.length > 0
      ? input.messages
      : [{ role: "user" as const, content: input.prompt }];
  const toolNamesById = new Map<string, string>();

  for (const message of sourceMessages) {
    if (message.role === "user") {
      messages.push({ role: "user", content: extractMessageText(message.content) });
      continue;
    }

    if (message.role === "assistant" && Array.isArray(message.content)) {
      const text = message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("");
      const toolCalls = message.content
        .filter(
          (
            block
          ): block is {
            type: "tool_use";
            id: string;
            name: string;
            input: Record<string, unknown>;
          } => block.type === "tool_use"
        )
        .map((block) => {
          toolNamesById.set(block.id, block.name);
          return { function: { name: block.name, arguments: block.input } };
        });

      if (text || toolCalls.length > 0) {
        const assistantMsg: Record<string, unknown> = { role: "assistant" };
        if (text) assistantMsg.content = text;
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        messages.push(assistantMsg);
      }
      continue;
    }

    if (message.role === "tool" && Array.isArray(message.content)) {
      for (const block of message.content) {
        const toolName = toolNamesById.get(block.tool_use_id);
        if (!toolName) continue;
        messages.push({
          role: "tool",
          name: toolName,
          content: parsePossibleToolResponse(extractMessageText(block.content)),
        });
      }
    }
  }

  return messages;
}

/**
 * Select the appropriate tool list based on toolChoice, without mutating messages.
 */
function selectHFTTools(input: ToolCallingTaskInput): ReturnType<typeof mapHFTTools> | undefined {
  if (input.toolChoice === "none") return undefined;

  if (
    typeof input.toolChoice === "string" &&
    input.toolChoice !== "auto" &&
    input.toolChoice !== "required"
  ) {
    const selected = input.tools.filter((t: ToolDefinition) => t.name === input.toolChoice);
    return mapHFTTools(selected.length > 0 ? selected : input.tools);
  }

  return mapHFTTools(input.tools);
}

// ============================================================================
// Prompt building
// ============================================================================

/**
 * Check whether the input has multi-turn tool messages that need structured
 * message format (tool_calls on assistant, name on tool messages).
 */
function hasToolMessages(input: ToolCallingTaskInput): boolean {
  return input.messages?.some((m) => m.role === "tool") ?? false;
}

function buildPromptAndPrefix(
  tokenizer: TextGenerationPipeline["tokenizer"],
  input: ToolCallingTaskInput,
  modelFamily: string | null
): { prompt: string; responsePrefix: string | undefined } {
  let basePrompt: string;

  if (hasToolMessages(input)) {
    // Multi-turn with tool results: use structured messages so the tokenizer
    // can format tool_calls and tool responses correctly.
    const messages = buildHFTMessages(input);
    const tools = selectHFTTools(input);
    basePrompt = tokenizer.apply_chat_template(messages as any, {
      tools,
      tokenize: false,
      add_generation_prompt: true,
    }) as string;
  } else {
    // Single-turn or no tool results: flat messages work fine.
    const messages = toTextFlatMessages(input);
    const tools = resolveHFTToolsAndMessages(input, messages);
    basePrompt = tokenizer.apply_chat_template(messages, {
      tools,
      tokenize: false,
      add_generation_prompt: true,
    }) as string;
  }

  const responsePrefix =
    input.toolChoice === "none" || hasToolMessages(input)
      ? undefined
      : getGenerationPrefix(modelFamily, forcedToolSelection(input));

  return {
    prompt: responsePrefix ? `${basePrompt}${responsePrefix}` : basePrompt,
    responsePrefix,
  };
}

// ============================================================================
// Provider run functions
// ============================================================================

export const HFT_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  HfTransformersOnnxModelConfig
> = async (input, model, onProgress, signal) => {
  const generateText: TextGenerationPipeline = await getPipeline(model!, onProgress, {}, signal);
  const { TextStreamer } = await loadTransformersSDK();

  const hfTokenizer = generateText.tokenizer;
  const hfModel = generateText.model;

  const streamer = createTextStreamer(hfTokenizer, onProgress, TextStreamer, signal);
  const modelFamily = detectModelFamilyFromConfig(model!);
  const { prompt, responsePrefix } = buildPromptAndPrefix(hfTokenizer, input, modelFamily);

  const inputs = hfTokenizer(prompt, { return_tensors: "pt" }) as { input_ids: Tensor };

  const output = (await hfModel.generate({
    ...inputs,
    max_new_tokens: input.maxTokens ?? 1024,
    streamer,
  })) as Tensor;
  const promptLen = inputs.input_ids.dims[1];
  const seqLen = output.dims[1];
  const newTokens = output.slice(0, [promptLen, seqLen]);
  const decoded = hfTokenizer.decode(newTokens, {
    skip_special_tokens: false,
  });
  const parseableText = responsePrefix ? `${responsePrefix}${decoded}` : decoded;
  const { text, toolCalls } = adaptParserResult(
    parseToolCalls(parseableText, { parser: modelFamily })
  );
  return {
    text,
    toolCalls: filterValidToolCalls(normalizeParsedToolCalls(input, toolCalls), input.tools),
  };
};

export const HFT_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  HfTransformersOnnxModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  const noopProgress = () => {};
  const generateText: TextGenerationPipeline = await getPipeline(model!, noopProgress, {}, signal);
  const { TextStreamer } = await loadTransformersSDK();
  const modelFamily = detectModelFamilyFromConfig(model!);
  const { prompt, responsePrefix } = buildPromptAndPrefix(
    generateText.tokenizer,
    input,
    modelFamily
  );

  // Two queues: the inner queue receives raw tokens from the TextStreamer,
  // the outer queue receives filtered text-delta events (markup stripped).
  const innerQueue = createStreamEventQueue<StreamEvent<ToolCallingTaskOutput>>();
  const outerQueue = createStreamEventQueue<StreamEvent<ToolCallingTaskOutput>>();
  const streamer = createStreamingTextStreamer(
    generateText.tokenizer,
    innerQueue,
    TextStreamer,
    signal
  );

  let fullText = "";
  const filter = createToolCallMarkupFilter((text) => {
    outerQueue.push({ type: "text-delta", port: "text", textDelta: text });
  });

  // Intercept raw text-delta events: accumulate the full text for post-hoc
  // parsing and feed tokens through the markup filter before forwarding.
  const originalPush = innerQueue.push;
  innerQueue.push = (event: StreamEvent<ToolCallingTaskOutput>) => {
    if (event.type === "text-delta" && "textDelta" in event) {
      fullText += event.textDelta;
      filter.feed(event.textDelta);
    } else {
      outerQueue.push(event);
    }
    originalPush(event);
  };

  const originalDone = innerQueue.done;
  innerQueue.done = () => {
    filter.flush();
    outerQueue.done();
    originalDone();
  };

  const originalError = innerQueue.error;
  innerQueue.error = (e: Error) => {
    filter.flush();
    outerQueue.error(e);
    originalError(e);
  };

  const pipelinePromise = generateText(prompt, {
    max_new_tokens: input.maxTokens ?? 1024,
    temperature: input.temperature ?? undefined,
    return_full_text: false,
    streamer,
  }).then(
    () => innerQueue.done(),
    (err: Error) => innerQueue.error(err)
  );

  yield* outerQueue.iterable;
  await pipelinePromise;

  // Parse the accumulated text for tool calls using the model-family-aware parser.
  // For models that use a generation prefix, prepend it so the parser sees the
  // full markup pattern.
  const parseableFullText = responsePrefix ? `${responsePrefix}${fullText}` : fullText;
  const { text: cleanedText, toolCalls } = adaptParserResult(
    parseToolCalls(parseableFullText, { parser: modelFamily })
  );
  const validToolCalls = filterValidToolCalls(
    normalizeParsedToolCalls(input, toolCalls),
    input.tools
  );

  if (validToolCalls.length > 0) {
    yield { type: "object-delta", port: "toolCalls", objectDelta: [...validToolCalls] };
  }

  yield {
    type: "finish",
    data: { text: cleanedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
  };
};
