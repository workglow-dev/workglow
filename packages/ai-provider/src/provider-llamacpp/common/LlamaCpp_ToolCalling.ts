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
import { getLogger } from "@workglow/util";
import type { LlamaCppModelConfig } from "./LlamaCpp_ModelSchema";
import { getLlamaCppSdk, getOrCreateTextContext, loadSdk } from "./LlamaCpp_Runtime";

function buildLlamaCppPrompt(input: ToolCallingTaskInput): string {
  const inputMessages = input.messages;
  if (!inputMessages || inputMessages.length === 0) {
    return Array.isArray(input.prompt) ? input.prompt.join("\n") : input.prompt;
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
  if (Array.isArray(input.prompt)) {
    getLogger().warn(
      "LlamaCpp_ToolCalling: array input received; processing sequentially (no native batch support)"
    );
    const prompts = input.prompt as string[];
    const texts: string[] = [];
    const toolCallsList: ToolCalls[] = [];
    for (const item of prompts) {
      const r = await LlamaCpp_ToolCalling(
        { ...input, prompt: item },
        model,
        update_progress,
        signal
      );
      texts.push(r.text as string);
      toolCallsList.push(r.toolCalls as ToolCalls);
    }
    return { text: texts, toolCalls: toolCallsList } as unknown as ToolCallingTaskOutput;
  }

  if (!model) throw new Error("Model config is required for ToolCallingTask.");

  await loadSdk();

  update_progress(0, "Loading model");
  const context = await getOrCreateTextContext(model);

  const capturedCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const functions =
    input.toolChoice === "none" ? undefined : buildLlamaCppFunctions(input.tools, capturedCalls);

  update_progress(10, "Running tool calling");
  const sequence = context.getSequence();
  const { LlamaChatSession } = getLlamaCppSdk();
  const promptText = buildLlamaCppPrompt(input);
  const session = new LlamaChatSession({
    contextSequence: sequence,
    ...(input.systemPrompt && { systemPrompt: input.systemPrompt }),
  });

  try {
    const text = await session.prompt(promptText, {
      signal,
      ...(functions && { functions }),
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
    });

    const toolCalls: ToolCalls = [];
    capturedCalls.forEach((call, index) => {
      const id = `call_${index}`;
      toolCalls.push({ id, name: call.name, input: call.input });
    });

    update_progress(100, "Tool calling complete");
    return { text, toolCalls: filterValidToolCalls(toolCalls, input.tools) };
  } finally {
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

  const capturedCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const functions =
    input.toolChoice === "none" ? undefined : buildLlamaCppFunctions(input.tools, capturedCalls);

  const sequence = context.getSequence();
  const { LlamaChatSession } = getLlamaCppSdk();
  const promptText = buildLlamaCppPrompt(input);
  const session = new LlamaChatSession({
    contextSequence: sequence,
    ...(input.systemPrompt && { systemPrompt: input.systemPrompt }),
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
      ...(functions && { functions }),
      onTextChunk: (chunk: string) => {
        queue.push(chunk);
        notifyWaiter();
      },
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
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
  const validToolCalls = filterValidToolCalls(toolCalls, input.tools);

  if (validToolCalls.length > 0) {
    yield { type: "object-delta", port: "toolCalls", objectDelta: [...validToolCalls] };
  }

  yield {
    type: "finish",
    data: { text: accumulatedText, toolCalls: validToolCalls } as ToolCallingTaskOutput,
  };
};
