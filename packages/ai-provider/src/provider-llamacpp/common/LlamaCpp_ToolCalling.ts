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
  hasToolCallMarkers,
  llamaCppForcedToolResponsePrefix,
  supportsNativeFunctions,
  toolChoiceForcesToolCall,
} from "./LlamaCpp_ToolParser";
import {
  getLlamaCppSdk,
  getOrCreateTextContext,
  llamaCppChatSessionConstructorSpread,
  llamaCppSeedPromptSpread,
  loadSdk,
} from "./LlamaCpp_Runtime";

function buildLlamaCppPrompt(input: ToolCallingTaskInput): string {
  const inputMessages = input.messages;
  if (!inputMessages || inputMessages.length === 0) {
    return input.prompt as string;
  }

  const parts: string[] = [];
  for (const msg of inputMessages) {
    if (msg.role === "user") {
      parts.push(`User: ${msg.content}`);
    } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const text = msg.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      if (text) parts.push(`Assistant: ${text}`);
    } else if (msg.role === "tool" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        parts.push(`Tool Result: ${block.content}`);
      }
    }
  }
  return parts.join("\n\n");
}

function buildSystemPrompt(input: ToolCallingTaskInput): string | undefined {
  const base = input.systemPrompt;
  if (input.toolChoice === "required") {
    const instruction =
      "You must call at least one tool from the provided tool list when answering.";
    return base ? `${base}\n\n${instruction}` : instruction;
  }
  return base || undefined;
}

/**
 * Sampling and related options for {@link LlamaChatSession.prompt}.
 * When the caller forces tool use (`required` or a specific tool name) but did not set
 * `temperature`, node-llama-cpp still uses greedy decoding (temperature 0). Small models
 * often prefer a direct text answer over tool syntax under greedy decoding, so we default
 * to a modest temperature in that case.
 */
function llamaCppToolCallingPromptOptions(
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
  const responsePrefix = llamaCppForcedToolResponsePrefix(input, model);
  if (responsePrefix !== undefined) {
    opts.responsePrefix = responsePrefix;
  }
  return opts;
}

function buildLlamaCppFunctions(
  tools: ReadonlyArray<ToolDefinition>,
  capturedCalls: Array<{ name: string; input: Record<string, unknown> }>
) {
  const { defineChatSessionFunction } = getLlamaCppSdk();
  const functions: Record<string, any> = {};
  for (const tool of tools) {
    const toolName = tool.name;
    functions[toolName] = defineChatSessionFunction({
      description: tool.description,
      params: tool.inputSchema as any,
      handler(params: any) {
        capturedCalls.push({ name: toolName, input: (params ?? {}) as Record<string, unknown> });
        return "OK";
      },
    } as any);
  }
  return functions;
}

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
  const { LlamaChatSession, LlamaCompletion } = getLlamaCppSdk();
  const promptText = buildLlamaCppPrompt(input);
  const systemPrompt = buildSystemPrompt(input);

  const rawPrompt = buildRawCompletionPrompt(input, model, systemPrompt);
  const capturedCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const functions = supportsNativeFunctions(input, model)
    ? buildLlamaCppFunctions(input.tools, capturedCalls)
    : undefined;

  if (rawPrompt !== undefined) {
    const completion = new LlamaCompletion({ contextSequence: sequence });
    try {
      const text = await completion.generateCompletion(rawPrompt, {
        signal,
        ...llamaCppToolCallingPromptOptions(input, model),
      });

      const toolCalls = filterValidToolCalls(
        extractToolCallsFromText(text, input, model),
        input.tools
      );
      update_progress(100, "Tool calling complete");
      return { text, toolCalls };
    } finally {
      completion.dispose({ disposeSequence: false });
      sequence.dispose();
    }
  }

  const session = new LlamaChatSession({
    contextSequence: sequence,
    ...llamaCppChatSessionConstructorSpread(model),
    ...(systemPrompt && { systemPrompt }),
  });

  try {
    const text = await session.prompt(promptText, {
      signal,
      ...llamaCppToolCallingPromptOptions(input, model),
      ...(functions && {
        functions,
        ...(toolChoiceForcesToolCall(input.toolChoice) && { documentFunctionParams: true }),
      }),
    });

    const toolCalls: ToolCalls = [];
    capturedCalls.forEach((call, index) => {
      const id = `call_${index}`;
      toolCalls.push({ id, name: call.name, input: call.input });
    });
    if (
      toolCalls.length === 0 &&
      hasToolCallMarkers(text)
    ) {
      toolCalls.push(...extractToolCallsFromText(text, input, model));
    }

    update_progress(100, "Tool calling complete");
    return { text, toolCalls: filterValidToolCalls(toolCalls, input.tools) };
  } finally {
    session.dispose({ disposeSequence: false });
    sequence.dispose();
  }
};

export const LlamaCpp_ToolCalling_Stream: AiProviderStreamFn<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  LlamaCppModelConfig
> = async function* (input, model, signal): AsyncIterable<StreamEvent<ToolCallingTaskOutput>> {
  if (!model) throw new Error("Model config is required for ToolCallingTask.");

  await loadSdk();

  const context = await getOrCreateTextContext(model);

  const sequence = context.getSequence();
  const { LlamaChatSession, LlamaCompletion } = getLlamaCppSdk();
  const promptText = buildLlamaCppPrompt(input);
  const systemPrompt = buildSystemPrompt(input);

  const rawPrompt = buildRawCompletionPrompt(input, model, systemPrompt);
  const capturedCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const functions = supportsNativeFunctions(input, model)
    ? buildLlamaCppFunctions(input.tools, capturedCalls)
    : undefined;

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
        ...llamaCppToolCallingPromptOptions(input, model),
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

    const validToolCalls = filterValidToolCalls(
      extractToolCallsFromText(accumulatedText, input, model),
      input.tools
    );

    if (validToolCalls.length > 0) {
      yield { type: "object-delta", port: "toolCalls", objectDelta: [...validToolCalls] };
    }

    yield {
      type: "finish",
      data: { text: accumulatedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
    };
    return;
  }

  const session = new LlamaChatSession({
    contextSequence: sequence,
    ...llamaCppChatSessionConstructorSpread(model),
    ...(systemPrompt && { systemPrompt }),
  });

  const queue: string[] = [];
  let isComplete = false;
  let completionError: unknown;
  let resolveWait: (() => void) | null = null;

  const notifyWaiter = () => {
    resolveWait?.();
    resolveWait = null;
  };

  let accumulatedText = "";
  const promptPromise = session
    .prompt(promptText, {
      signal,
      ...llamaCppToolCallingPromptOptions(input, model),
      ...(functions && {
        functions,
        ...(toolChoiceForcesToolCall(input.toolChoice) && { documentFunctionParams: true }),
      }),
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
    await promptPromise.catch(() => {});
    session.dispose({ disposeSequence: false });
    sequence.dispose();
  }

  if (completionError) {
    if (!signal.aborted) throw completionError;
    return;
  }

  const toolCalls: ToolCalls = [];
  capturedCalls.forEach((call, index) => {
    const id = `call_${index}`;
    toolCalls.push({ id, name: call.name, input: call.input });
  });
  if (toolCalls.length === 0 && accumulatedText.includes("<tool_call>")) {
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
