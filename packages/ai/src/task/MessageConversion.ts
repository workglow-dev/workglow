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
  content: string | null | Array<{ type: string; [key: string]: unknown }>;
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
    if (!Array.isArray(input.prompt)) {
      messages.push({ role: "user", content: input.prompt });
    } else if (input.prompt.every((item) => typeof item === "string")) {
      messages.push({ role: "user", content: (input.prompt as string[]).join("\n") });
    } else {
      const parts: Array<{ type: string; [key: string]: unknown }> = [];
      for (const item of input.prompt) {
        if (typeof item === "string") {
          parts.push({ type: "text", text: item });
        } else {
          const b = item as Record<string, unknown>;
          if (b.type === "text") {
            parts.push({ type: "text", text: b.text as string });
          } else if (b.type === "image") {
            parts.push({
              type: "image_url",
              image_url: { url: `data:${b.mimeType};base64,${b.data}` },
            });
          } else if (b.type === "audio") {
            const format = (b.mimeType as string).replace(/^audio\//, "");
            parts.push({
              type: "input_audio",
              input_audio: { data: b.data as string, format },
            });
          }
        }
      }
      messages.push({ role: "user", content: parts });
    }
    return messages;
  }

  for (const msg of inputMessages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        messages.push({ role: "user", content: msg.content });
      } else if (
        Array.isArray(msg.content) &&
        msg.content.length > 0 &&
        typeof (msg.content[0] as Record<string, unknown>)?.type === "string"
      ) {
        const parts: Array<{ type: string; [key: string]: unknown }> = [];
        for (const block of msg.content) {
          const b = block as Record<string, unknown>;
          if (b.type === "text") {
            parts.push({ type: "text", text: b.text as string });
          } else if (b.type === "image") {
            parts.push({
              type: "image_url",
              image_url: { url: `data:${b.mimeType};base64,${b.data}` },
            });
          } else if (b.type === "audio") {
            const format = (b.mimeType as string).replace(/^audio\//, "");
            parts.push({
              type: "input_audio",
              input_audio: { data: b.data as string, format },
            });
          }
        }
        messages.push({ role: "user", content: parts });
      } else {
        try {
          messages.push({ role: "user", content: JSON.stringify(msg.content) });
        } catch {
          messages.push({ role: "user", content: String(msg.content) });
        }
      }
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        messages.push({ role: "assistant", content: msg.content.length > 0 ? msg.content : null });
      } else if (Array.isArray(msg.content)) {
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
      }
    } else if (msg.role === "tool" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const b = block as Record<string, unknown>;
        let content: string | Array<{ type: string; [key: string]: unknown }>;
        if (typeof b.content === "string") {
          content = b.content;
        } else if (Array.isArray(b.content)) {
          const parts: Array<{ type: string; [key: string]: unknown }> = [];
          for (const inner of b.content as Array<Record<string, unknown>>) {
            if (inner.type === "text") {
              parts.push({ type: "text", text: inner.text as string });
            } else if (inner.type === "image") {
              parts.push({
                type: "image_url",
                image_url: { url: `data:${inner.mimeType};base64,${inner.data}` },
              });
            }
          }
          content = parts;
        } else {
          content = "";
        }
        messages.push({
          role: "tool",
          content,
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
    let promptContent: string;
    if (!Array.isArray(input.prompt)) {
      promptContent = input.prompt;
    } else {
      // Extract text content only; media blocks are dropped in text-flat format
      promptContent = input.prompt
        .map((item) => {
          if (typeof item === "string") return item;
          const b = item as Record<string, unknown>;
          return b.type === "text" ? (b.text as string) : "";
        })
        .filter((s) => s !== "")
        .join("\n");
    }
    messages.push({ role: "user", content: promptContent });
    return messages;
  }

  for (const msg of inputMessages) {
    if (msg.role === "user") {
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (
        Array.isArray(msg.content) &&
        msg.content.length > 0 &&
        typeof (msg.content[0] as Record<string, unknown>)?.type === "string"
      ) {
        // Extract only text blocks; media blocks are dropped in text-flat format
        content = (msg.content as Array<Record<string, unknown>>)
          .filter((b) => b.type === "text")
          .map((b) => b.text as string)
          .join("");
      } else if (msg.content != null) {
        try {
          content = JSON.stringify(msg.content);
        } catch {
          content = String(msg.content);
        }
      }
      messages.push({ role: "user", content });
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        if (msg.content) {
          messages.push({ role: "assistant", content: msg.content });
        }
      } else if (Array.isArray(msg.content)) {
        const text = msg.content
          .filter((b: Record<string, unknown>) => b.type === "text")
          .map((b: Record<string, unknown>) => b.text as string)
          .join("");
        if (text) {
          messages.push({ role: "assistant", content: text });
        }
      }
    } else if (msg.role === "tool" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const b = block as Record<string, unknown>;
        let content: string;
        if (typeof b.content === "string") {
          content = b.content;
        } else if (Array.isArray(b.content)) {
          // Extract only text blocks from multi-part tool results
          content = (b.content as Array<Record<string, unknown>>)
            .filter((inner) => inner.type === "text")
            .map((inner) => inner.text as string)
            .join("");
        } else {
          content = "";
        }
        messages.push({ role: "tool", content });
      }
    }
  }

  return messages;
}
