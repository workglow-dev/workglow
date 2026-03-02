/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared message conversion utilities for converting provider-agnostic
 * ChatMessage arrays to provider-specific formats.
 *
 * These are pure functions safe for both main-thread and worker contexts.
 * Providers with unique requirements (Anthropic, Gemini, LlamaCpp)
 * maintain their own conversion logic.
 */

import type { ToolCallingTaskInput } from "./ToolCallingTask";

// ========================================================================
// Internal helpers
// ========================================================================

type InputMessages = ReadonlyArray<{ readonly role: string; readonly content: unknown }>;

/**
 * Extract the messages array from a ToolCallingTaskInput.
 * Returns undefined if no messages are present.
 */
function getInputMessages(input: ToolCallingTaskInput): InputMessages | undefined {
  const messages = input.messages;
  if (!messages || messages.length === 0) return undefined;
  return messages;
}

// ========================================================================
// OpenAI-compatible format (OpenAI, HF Inference)
// ========================================================================

export interface OpenAICompatMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/**
 * Converts ToolCallingTaskInput to OpenAI-compatible message format.
 * Used by OpenAI and HuggingFace Inference providers.
 *
 * Multi-turn capable: preserves full tool call metadata across turns.
 */
export function toOpenAIMessages(input: ToolCallingTaskInput): OpenAICompatMessage[] {
  const messages: OpenAICompatMessage[] = [];

  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt });
  }

  const inputMessages = getInputMessages(input);
  if (!inputMessages) {
    messages.push({ role: "user", content: input.prompt });
    return messages;
  }

  for (const msg of inputMessages) {
    if (msg.role === "user") {
      messages.push({ role: "user", content: msg.content as string });
    } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((b: Record<string, unknown>) => b.type === "text")
        .map((b: Record<string, unknown>) => b.text as string)
        .join("");
      const toolCalls = msg.content
        .filter((b: Record<string, unknown>) => b.type === "tool_use")
        .map((b: Record<string, unknown>) => ({
          id: b.id as string,
          type: "function" as const,
          function: {
            name: b.name as string,
            arguments: JSON.stringify(b.input),
          },
        }));
      const entry: OpenAICompatMessage = {
        role: "assistant",
        content: textParts.length > 0 ? textParts : null,
      };
      if (toolCalls.length > 0) {
        entry.tool_calls = toolCalls;
      }
      messages.push(entry);
    } else if (msg.role === "tool" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const b = block as Record<string, unknown>;
        messages.push({
          role: "tool",
          content: (b.content as string) ?? "",
          tool_call_id: b.tool_use_id as string,
        });
      }
    }
  }

  return messages;
}

// ========================================================================
// Text-flat format (Ollama, HF Transformers)
// ========================================================================

export interface TextFlatMessage {
  role: string;
  content: string;
}

/**
 * Converts ToolCallingTaskInput to a simplified text-only message format.
 * Used by providers that don't natively support structured multi-turn
 * tool calling (Ollama, HuggingFace Transformers).
 *
 * NOTE: This format discards tool_use blocks from assistant messages.
 * The LLM will not see what tools it previously called. Multi-turn tool
 * calling will have degraded quality on these providers.
 */
export function toTextFlatMessages(input: ToolCallingTaskInput): TextFlatMessage[] {
  const messages: TextFlatMessage[] = [];

  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt });
  }

  const inputMessages = getInputMessages(input);
  if (!inputMessages) {
    messages.push({ role: "user", content: input.prompt });
    return messages;
  }

  for (const msg of inputMessages) {
    if (msg.role === "user") {
      messages.push({ role: "user", content: msg.content as string });
    } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const text = msg.content
        .filter((b: Record<string, unknown>) => b.type === "text")
        .map((b: Record<string, unknown>) => b.text as string)
        .join("");
      if (text) {
        messages.push({ role: "assistant", content: text });
      }
    } else if (msg.role === "tool" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const b = block as Record<string, unknown>;
        messages.push({
          role: "tool",
          content: (b.content as string) ?? "",
        });
      }
    }
  }

  return messages;
}
