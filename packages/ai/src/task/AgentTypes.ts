/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DataPorts } from "@workglow/task-graph";
import { parseDataUri } from "@workglow/util/media";
import type { ToolCall, ToolCalls, ToolDefinition } from "./ToolCallingUtils";

// ========================================================================
// Chat message types — provider-agnostic conversation history
// ========================================================================

/**
 * A text content block within a chat message.
 */
export interface TextContentBlock {
  readonly type: "text";
  readonly text: string;
}

/**
 * An image content block within a chat message.
 */
export interface ImageContentBlock {
  readonly type: "image";
  readonly mimeType: string; // e.g. "image/png", "image/jpeg", "image/webp", "image/gif"
  readonly data: string; // raw base64 (no data-uri prefix)
}

/**
 * An audio content block within a chat message.
 */
export interface AudioContentBlock {
  readonly type: "audio";
  readonly mimeType: string; // e.g. "audio/wav", "audio/mp3", "audio/ogg"
  readonly data: string; // raw base64
}

/**
 * A tool-use content block within an assistant message.
 * Represents the LLM requesting a tool invocation.
 */
export interface ToolUseContentBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/**
 * A tool-result content block within a tool message.
 * Represents the result of executing a tool call.
 */
export interface ToolResultContentBlock {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  readonly content: string | ReadonlyArray<ToolResultInnerBlock>;
  readonly is_error?: boolean;
}

/** Content blocks allowed in user messages */
export type UserContentBlock = TextContentBlock | ImageContentBlock | AudioContentBlock;

/** Content blocks allowed inside tool result content */
export type ToolResultInnerBlock = TextContentBlock | ImageContentBlock | AudioContentBlock;

export type ContentBlock =
  | TextContentBlock
  | ImageContentBlock
  | AudioContentBlock
  | ToolUseContentBlock
  | ToolResultContentBlock;

/**
 * Provider-agnostic chat message for multi-turn conversations.
 * Uses a discriminated union on `role` to enforce correct content types.
 */
export type ChatMessage =
  | { readonly role: "user"; readonly content: string | ReadonlyArray<UserContentBlock> }
  | {
      readonly role: "assistant";
      readonly content: ReadonlyArray<TextContentBlock | ToolUseContentBlock>;
    }
  | { readonly role: "tool"; readonly content: ReadonlyArray<ToolResultContentBlock> };

// ========================================================================
// Tool source types — how tools are discovered and dispatched
// ========================================================================

/**
 * A tool backed by a Task in the TaskRegistry. Instantiated and run via
 * `TaskRegistry.all.get(taskType)`. Optional `config` is passed to the
 * task constructor for configurable tasks (e.g. `McpToolCallTask`,
 * `JavaScriptTask`).
 */
export interface RegistryToolSource {
  readonly type: "registry";
  readonly definition: ToolDefinition;
  readonly taskType: string;
  /** Configuration values passed to the task constructor. */
  readonly config?: DataPorts;
}

/**
 * A user-provided tool with a custom executor function.
 */
export interface FunctionToolSource {
  readonly type: "function";
  readonly definition: ToolDefinition;
  readonly run: (input: DataPorts) => Promise<DataPorts>;
}

export type ToolSource = RegistryToolSource | FunctionToolSource;

// ========================================================================
// Tool execution result
// ========================================================================

export interface ToolResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: DataPorts;
  readonly isError: boolean;
  /** Optional media content blocks to include alongside the JSON output. */
  readonly mediaContent?: ReadonlyArray<ToolResultInnerBlock>;
}

// ========================================================================
// Agent hooks — lifecycle callbacks for the agent loop
// ========================================================================

/**
 * Decision returned by the beforeToolCall hook.
 * - `"allow"`: proceed with the tool call as-is
 * - `"deny"`: skip the tool call and return an error to the LLM
 * - `"modify"`: proceed with modified input
 */
export type ToolCallDecision =
  | { readonly action: "allow" }
  | { readonly action: "deny"; readonly reason?: string }
  | { readonly action: "modify"; readonly input: Record<string, unknown> };

/**
 * Action returned by the onToolError hook.
 * - `"throw"`: report the error to the LLM (default when no hook)
 * - `"result"`: use a fallback result instead of reporting the error
 */
export type ToolErrorAction =
  | { readonly action: "throw" }
  | { readonly action: "result"; readonly output: Record<string, unknown> };

/**
 * Action returned by the onIteration hook.
 * - `"continue"`: proceed with the next LLM call
 * - `"stop"`: end the agent loop and return current results
 */
export type IterationAction = { readonly action: "continue" } | { readonly action: "stop" };

/**
 * Lifecycle hooks for the AgentTask loop.
 * All hooks are optional; the agent runs without intervention by default.
 */
export interface AgentHooks {
  /** Called before each tool call. Can approve, deny, or modify the call. */
  readonly beforeToolCall?: (call: ToolCall, source: ToolSource) => Promise<ToolCallDecision>;

  /** Called after each successful tool call. Can transform the result. */
  readonly afterToolCall?: (call: ToolCall, result: ToolResult) => Promise<ToolResult>;

  /** Called when a tool call throws. Can provide a fallback result or re-throw. */
  readonly onToolError?: (call: ToolCall, error: Error) => Promise<ToolErrorAction>;

  /**
   * Called at the start of each iteration, before calling the LLM.
   * Can stop the loop or inspect state (e.g. for context trimming).
   */
  readonly onIteration?: (
    iteration: number,
    messages: ReadonlyArray<ChatMessage>,
    stats: { readonly totalToolCalls: number }
  ) => Promise<IterationAction>;
}

// ========================================================================
// Factory functions for content blocks
// ========================================================================

export function imageBlock(mimeType: string, data: string): ImageContentBlock {
  return { type: "image", mimeType, data };
}

export function audioBlock(mimeType: string, data: string): AudioContentBlock {
  return { type: "audio", mimeType, data };
}

export function imageBlockFromDataUri(dataUri: string): ImageContentBlock {
  const { mimeType, base64 } = parseDataUri(dataUri);
  return { type: "image", mimeType, data: base64 };
}

export function audioBlockFromDataUri(dataUri: string): AudioContentBlock {
  const { mimeType, base64 } = parseDataUri(dataUri);
  return { type: "audio", mimeType, data: base64 };
}

// ========================================================================
// Helpers for building ChatMessage arrays
// ========================================================================

/**
 * Creates a user message from a prompt string or array of content blocks.
 */
export function userMessage(prompt: string | ReadonlyArray<UserContentBlock>): ChatMessage {
  return { role: "user", content: prompt };
}

/**
 * Creates an assistant message from text and optional tool calls.
 */
export function assistantMessage(text: string, toolCalls?: ToolCalls): ChatMessage {
  const content: Array<TextContentBlock | ToolUseContentBlock> = [];
  if (text) {
    content.push({ type: "text", text });
  }
  if (toolCalls) {
    for (const tc of toolCalls) {
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.input,
      });
    }
  }
  return { role: "assistant", content };
}

/**
 * Creates a tool message from an array of tool results.
 * When a result has `mediaContent`, emits content as an array of blocks
 * instead of a plain JSON string.
 */
export function toolMessage(results: ReadonlyArray<ToolResult>): ChatMessage {
  return {
    role: "tool",
    content: results.map((r) => {
      const jsonText = JSON.stringify(r.output);
      const content: string | ReadonlyArray<ToolResultInnerBlock> =
        r.mediaContent && r.mediaContent.length > 0
          ? [{ type: "text" as const, text: jsonText }, ...r.mediaContent]
          : jsonText;
      return {
        type: "tool_result" as const,
        tool_use_id: r.toolCallId,
        content,
        is_error: r.isError || undefined,
      };
    }),
  };
}

/**
 * Extracts all ToolDefinitions from an array of ToolSources.
 */
export function toolSourceDefinitions(sources: ReadonlyArray<ToolSource>): ToolDefinition[] {
  return sources.map((s) => s.definition);
}

/**
 * Finds the ToolSource matching a tool call name.
 */
export function findToolSource(
  sources: ReadonlyArray<ToolSource>,
  name: string
): ToolSource | undefined {
  return sources.find((s) => s.definition.name === name);
}
