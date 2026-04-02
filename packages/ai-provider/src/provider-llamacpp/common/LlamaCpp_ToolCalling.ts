/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { filterValidToolCalls } from "@workglow/ai/worker";
import type {
  AiProviderRunFn,
  AiProviderStreamFn,
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  ToolCalls,
  ToolDefinition,
} from "@workglow/ai";
import type { StreamEvent } from "@workglow/task-graph";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import {
  buildRawCompletionPrompt,
  extractToolCallsFromText,
  supportsNativeFunctions,
  toolChoiceForcesToolCall,
  truncateAtTurnBoundary,
} from "./LlamaCpp_ToolParser";
import {
  getLlamaCppSdk,
  getOrCreateTextContext,
  llamaCppChatSessionConstructorSpread,
  llamaCppSeedPromptSpread,
  loadSdk,
} from "./LlamaCpp_Runtime";
import { getLogger } from "@workglow/util/worker";

// ============================================================================
// System prompt
// ============================================================================

function buildSystemPrompt(input: ToolCallingTaskInput): string | undefined {
  const base = input.systemPrompt;
  if (input.toolChoice === "required") {
    const instruction =
      "You must call at least one tool from the provided tool list when answering.";
    return base ? `${base}\n\n${instruction}` : instruction;
  }
  return base || undefined;
}

// ============================================================================
// Message → ChatHistoryItem[] conversion
// ============================================================================

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .filter((block: any) => block?.type === "text")
    .map((block: any) => String(block.text ?? ""))
    .join("");
}

/**
 * Convert workglow messages to node-llama-cpp's `ChatHistoryItem[]`.
 *
 * Key difference from OpenAI/Anthropic format: tool results are NOT separate
 * history items. They get merged into the preceding `model` response's
 * `ChatModelFunctionCall.result` fields, matched by `tool_use_id`.
 */
function convertMessagesToChatHistory(
  messages: ToolCallingTaskInput["messages"],
  prompt: string | undefined,
  systemPrompt: string | undefined
): any[] {
  const history: any[] = [];

  if (systemPrompt) {
    history.push({ type: "system", text: systemPrompt });
  }

  if (!messages || messages.length === 0) {
    const promptText = typeof prompt === "string" ? prompt : String(prompt ?? "");
    history.push({ type: "user", text: promptText });
    return history;
  }

  for (const msg of messages) {
    if (msg.role === "user") {
      const text = extractTextFromContent(msg.content);
      history.push({ type: "user", text });
      continue;
    }

    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const response: any[] = [];

      for (const block of msg.content as any[]) {
        if (block.type === "text" && block.text) {
          response.push(block.text);
        } else if (block.type === "tool_use") {
          // Create functionCall entry — result will be filled by subsequent tool message
          response.push({
            type: "functionCall",
            name: block.name,
            description: undefined,
            params: block.input ?? {},
            result: undefined,
            // Tag with id so we can match tool results below
            _toolUseId: block.id,
          });
        }
      }

      history.push({ type: "model", response });
      continue;
    }

    if (msg.role === "tool" && Array.isArray(msg.content)) {
      // Find the most recent "model" response to merge results into
      let lastModel: any | undefined;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].type === "model") {
          lastModel = history[i];
          break;
        }
      }
      if (!lastModel) continue;

      for (const block of msg.content as any[]) {
        const toolUseId = block.tool_use_id;
        if (!toolUseId) continue;

        // Find the matching functionCall in the model response
        const fnCall = lastModel.response.find(
          (item: any) =>
            typeof item === "object" &&
            item !== null &&
            item.type === "functionCall" &&
            item._toolUseId === toolUseId &&
            item.result === undefined
        );
        if (fnCall) {
          fnCall.result =
            typeof block.content === "string" ? block.content : JSON.stringify(block.content);
        }
      }
      continue;
    }
  }

  // Clean up the temporary _toolUseId tags from functionCall objects
  for (const item of history) {
    if (item.type === "model" && Array.isArray(item.response)) {
      for (const entry of item.response) {
        if (typeof entry === "object" && entry !== null && "_toolUseId" in entry) {
          delete entry._toolUseId;
        }
      }
    }
  }

  return history;
}

// ============================================================================
// ChatModelFunctions builder (schema only, no handlers)
// ============================================================================

function buildChatModelFunctions(
  tools: ReadonlyArray<ToolDefinition>
): Record<string, { description?: string; params?: any }> {
  const functions: Record<string, { description?: string; params?: any }> = {};
  for (const tool of tools) {
    functions[tool.name] = {
      ...(tool.description && { description: tool.description }),
      ...(tool.inputSchema && { params: tool.inputSchema }),
    };
  }
  return functions;
}

// ============================================================================
// Prompt options
// ============================================================================

/**
 * Sampling options for {@link LlamaCompletion.generateCompletion} (FunctionGemma raw path).
 * Includes `responsePrefix` which is only supported on the raw completion path.
 */
function llamaCppRawCompletionOptions(
  input: ToolCallingTaskInput,
  model: LlamaCppModelConfig
): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    ...llamaCppSeedPromptSpread(model.provider_config),
  };
  if (input.maxTokens !== undefined) {
    opts.maxTokens = input.maxTokens;
  }
  if (input.temperature !== undefined) {
    opts.temperature = input.temperature;
  } else if (toolChoiceForcesToolCall(input.toolChoice)) {
    opts.temperature = 0.2;
  }
  return opts;
}

/**
 * Sampling options for {@link LlamaChat.generateResponse}.
 * Does NOT include `responsePrefix` (not supported by LlamaChat).
 */
function llamaCppChatGenerateOptions(
  input: ToolCallingTaskInput,
  model: LlamaCppModelConfig
): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    ...llamaCppSeedPromptSpread(model.provider_config),
  };
  if (input.maxTokens !== undefined) {
    opts.maxTokens = input.maxTokens;
  }
  if (input.temperature !== undefined) {
    opts.temperature = input.temperature;
  } else if (toolChoiceForcesToolCall(input.toolChoice)) {
    opts.temperature = 0.2;
  }
  return opts;
}

// ============================================================================
// Extract tool calls from LlamaChat response
// ============================================================================

function extractNativeFunctionCalls(
  functionCalls: ReadonlyArray<{ functionName: string; params: any }> | undefined
): ToolCalls {
  if (!functionCalls || functionCalls.length === 0) return [];
  return functionCalls.map((fc, index) => ({
    id: `call_${index}`,
    name: fc.functionName,
    input: (fc.params ?? {}) as Record<string, unknown>,
  }));
}

// ============================================================================
// Non-streaming run function
// ============================================================================

export const LlamaCpp_ToolCalling: AiProviderRunFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  LlamaCppModelConfig
> = async (input, model, update_progress, signal) => {
  if (!model) throw new Error("Model config is required for ToolCallingTask.");

  await loadSdk();

  update_progress(0, "Loading model");
  const context = await getOrCreateTextContext(model);

  update_progress(10, "Running tool calling");
  const sequence = context.getSequence();
  const { LlamaChat, LlamaCompletion } = getLlamaCppSdk();
  const systemPrompt = buildSystemPrompt(input);

  // ---- FunctionGemma raw completion path (unchanged) ----
  const rawPrompt = buildRawCompletionPrompt(input, model, systemPrompt);

  getLogger().debug("rawPrompt", { rawPrompt });
  getLogger().debug("systemPrompt", { systemPrompt });

  if (rawPrompt !== undefined) {
    const completion = new LlamaCompletion({ contextSequence: sequence });
    try {
      const rawText = await completion.generateCompletion(rawPrompt, {
        signal,
        ...llamaCppRawCompletionOptions(input, model),
      });

      const text = truncateAtTurnBoundary(rawText);
      getLogger().debug("text", { text });
      const toolCalls = filterValidToolCalls(
        extractToolCallsFromText(text, input, model),
        input.tools
      );
      getLogger().debug("toolCalls", { toolCalls });
      update_progress(100, "Tool calling complete");
      return { text, toolCalls };
    } finally {
      completion.dispose({ disposeSequence: false });
      sequence.dispose();
    }
  }

  // ---- Native function calling path via LlamaChat ----
  const llamaChat = new LlamaChat({
    contextSequence: sequence,
    ...llamaCppChatSessionConstructorSpread(model),
  });

  const promptText =
    typeof input.prompt === "string" ? input.prompt : extractTextFromContent(input.prompt);
  const chatHistory = convertMessagesToChatHistory(input.messages, promptText, systemPrompt);
  const functions = supportsNativeFunctions(input, model)
    ? buildChatModelFunctions(input.tools)
    : undefined;

  getLogger().debug("chatHistory", { chatHistory });
  getLogger().debug("functions", functions);

  try {
    const res = await llamaChat.generateResponse(chatHistory, {
      signal,
      ...llamaCppChatGenerateOptions(input, model),
      ...(functions && {
        functions,
        ...(toolChoiceForcesToolCall(input.toolChoice) && { documentFunctionParams: true }),
      }),
    });

    const text = res.response;
    const toolCalls = extractNativeFunctionCalls(res.functionCalls);

    // Fallback: parse tool calls from text if native parsing found nothing
    if (toolCalls.length === 0 && input.tools.length > 0 && input.toolChoice !== "none") {
      toolCalls.push(...extractToolCallsFromText(text, input, model));
    }

    update_progress(100, "Tool calling complete");
    return { text, toolCalls: filterValidToolCalls(toolCalls, input.tools) };
  } finally {
    llamaChat.dispose({ disposeSequence: false });
    sequence.dispose();
  }
};

// ============================================================================
// Streaming run function
// ============================================================================

export const LlamaCpp_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  LlamaCppModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  if (!model) throw new Error("Model config is required for ToolCallingTask.");

  await loadSdk();

  const context = await getOrCreateTextContext(model);

  const sequence = context.getSequence();
  const { LlamaChat, LlamaCompletion } = getLlamaCppSdk();
  const systemPrompt = buildSystemPrompt(input);

  // ---- FunctionGemma raw completion path (unchanged) ----
  const rawPrompt = buildRawCompletionPrompt(input, model, systemPrompt);

  if (rawPrompt !== undefined) {
    const completion = new LlamaCompletion({ contextSequence: sequence });
    const queue: string[] = [];
    let isComplete = false;
    let completionError: unknown;
    let resolveWait: (() => void) | null = null;
    let accumulatedText = "";

    const notifyWaiter = () => {
      resolveWait?.();
      resolveWait = null;
    };

    const completionPromise = completion
      .generateCompletion(rawPrompt, {
        signal,
        ...llamaCppRawCompletionOptions(input, model),
        onTextChunk: (chunk: string) => {
          queue.push(chunk);
          notifyWaiter();
        },
      })
      .then(() => {
        isComplete = true;
        notifyWaiter();
      })
      .catch((err: unknown) => {
        completionError = err;
        isComplete = true;
        notifyWaiter();
      });

    try {
      while (true) {
        while (queue.length > 0) {
          const chunk = queue.shift()!;
          accumulatedText += chunk;
          yield { type: "text-delta", port: "text", textDelta: chunk };
        }
        if (isComplete) break;
        await new Promise<void>((r) => {
          resolveWait = r;
        });
      }
      while (queue.length > 0) {
        const chunk = queue.shift()!;
        accumulatedText += chunk;
        yield { type: "text-delta", port: "text", textDelta: chunk };
      }
    } finally {
      await completionPromise.catch(() => {});
      completion.dispose({ disposeSequence: false });
      sequence.dispose();
    }

    if (completionError) {
      if (!signal.aborted) throw completionError;
      return;
    }

    const truncatedText = truncateAtTurnBoundary(accumulatedText);
    const validToolCalls = filterValidToolCalls(
      extractToolCallsFromText(truncatedText, input, model),
      input.tools
    );

    if (validToolCalls.length > 0) {
      yield { type: "object-delta", port: "toolCalls", objectDelta: [...validToolCalls] };
    }

    yield {
      type: "finish",
      data: { text: truncatedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
    };
    return;
  }

  // ---- Native function calling path via LlamaChat ----
  const llamaChat = new LlamaChat({
    contextSequence: sequence,
    ...llamaCppChatSessionConstructorSpread(model),
  });

  const promptText =
    typeof input.prompt === "string" ? input.prompt : extractTextFromContent(input.prompt);
  const chatHistory = convertMessagesToChatHistory(input.messages, promptText, systemPrompt);
  const functions = supportsNativeFunctions(input, model)
    ? buildChatModelFunctions(input.tools)
    : undefined;

  const queue: string[] = [];
  let isComplete = false;
  let completionError: unknown;
  let resolveWait: (() => void) | null = null;
  let accumulatedText = "";
  let chatResponse: Awaited<ReturnType<InstanceType<typeof LlamaChat>["generateResponse"]>> | undefined;

  const notifyWaiter = () => {
    resolveWait?.();
    resolveWait = null;
  };

  const responsePromise = llamaChat
    .generateResponse(chatHistory, {
      signal,
      ...llamaCppChatGenerateOptions(input, model),
      ...(functions && {
        functions,
        ...(toolChoiceForcesToolCall(input.toolChoice) && { documentFunctionParams: true }),
      }),
      onTextChunk: (chunk: string) => {
        queue.push(chunk);
        notifyWaiter();
      },
    })
    .then((res) => {
      chatResponse = res;
      isComplete = true;
      notifyWaiter();
    })
    .catch((err: unknown) => {
      completionError = err;
      isComplete = true;
      notifyWaiter();
    });

  try {
    while (true) {
      while (queue.length > 0) {
        const chunk = queue.shift()!;
        accumulatedText += chunk;
        yield { type: "text-delta", port: "text", textDelta: chunk };
      }
      if (isComplete) break;
      await new Promise<void>((r) => {
        resolveWait = r;
      });
    }
    while (queue.length > 0) {
      const chunk = queue.shift()!;
      accumulatedText += chunk;
      yield { type: "text-delta", port: "text", textDelta: chunk };
    }
  } finally {
    await responsePromise.catch(() => {});
    llamaChat.dispose({ disposeSequence: false });
    sequence.dispose();
  }

  if (completionError) {
    if (!signal.aborted) throw completionError;
    return;
  }

  const toolCalls = extractNativeFunctionCalls(chatResponse?.functionCalls);

  // Fallback: parse tool calls from text if native parsing found nothing
  if (toolCalls.length === 0 && input.tools.length > 0 && input.toolChoice !== "none") {
    toolCalls.push(...extractToolCallsFromText(accumulatedText, input, model));
  }
  const validToolCalls = filterValidToolCalls(toolCalls, input.tools);

  if (validToolCalls.length > 0) {
    yield { type: "object-delta", port: "toolCalls", objectDelta: [...validToolCalls] };
  }

  yield {
    type: "finish",
    data: { text: accumulatedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
  };
};
