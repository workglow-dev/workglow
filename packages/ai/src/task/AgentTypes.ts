/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCall, ToolDefinition } from "./ToolCallingTask";

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
  readonly content: string;
  readonly is_error?: boolean;
}

export type ContentBlock = TextContentBlock | ToolUseContentBlock | ToolResultContentBlock;

/**
 * Provider-agnostic chat message for multi-turn conversations.
 * Uses a discriminated union on `role` to enforce correct content types.
 */
export type ChatMessage =
  | { readonly role: "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: ReadonlyArray<TextContentBlock | ToolUseContentBlock>;
    }
  | { readonly role: "tool"; readonly content: ReadonlyArray<ToolResultContentBlock> };

// ========================================================================
// Tool source types — how tools are discovered and dispatched
// ========================================================================

/**
 * A tool from the TaskRegistry that can be instantiated and run.
 */
export interface RegistryToolSource {
  readonly type: "registry";
  readonly definition: ToolDefinition;
  readonly taskType: string;
}

/**
 * A tool from an MCP server that is dispatched via McpToolCallTask.
 */
export interface McpToolSource {
  readonly type: "mcp";
  readonly definition: ToolDefinition;
  readonly mcpConfig: {
    readonly transport: string;
    readonly server_url?: string;
    readonly command?: string;
    readonly args?: ReadonlyArray<string>;
    readonly env?: Readonly<Record<string, string>>;
  };
}

/**
 * A user-provided tool with a custom executor function.
 */
export interface FunctionToolSource {
  readonly type: "function";
  readonly definition: ToolDefinition;
  readonly run: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export type ToolSource = RegistryToolSource | McpToolSource | FunctionToolSource;

// ========================================================================
// Tool execution result
// ========================================================================

export interface ToolResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: Record<string, unknown>;
  readonly isError: boolean;
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
export type IterationAction =
  | { readonly action: "continue" }
  | { readonly action: "stop" };

/**
 * Lifecycle hooks for the AgentTask loop.
 * All hooks are optional; the agent runs without intervention by default.
 */
export interface AgentHooks {
  /** Called before each tool call. Can approve, deny, or modify the call. */
  readonly beforeToolCall?: (
    call: ToolCall,
    source: ToolSource
  ) => Promise<ToolCallDecision>;

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
// Helpers for building ChatMessage arrays
// ========================================================================

/**
 * Creates a user message from a prompt string.
 */
export function userMessage(prompt: string): ChatMessage {
  return { role: "user", content: prompt };
}

/**
 * Creates an assistant message from text and optional tool calls.
 */
export function assistantMessage(
  text: string,
  toolCalls?: Record<string, ToolCall>
): ChatMessage {
  const content: Array<TextContentBlock | ToolUseContentBlock> = [];
  if (text) {
    content.push({ type: "text", text });
  }
  if (toolCalls) {
    for (const tc of Object.values(toolCalls)) {
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
 */
export function toolMessage(results: ReadonlyArray<ToolResult>): ChatMessage {
  return {
    role: "tool",
    content: results.map((r) => ({
      type: "tool_result" as const,
      tool_use_id: r.toolCallId,
      content: JSON.stringify(r.output),
      is_error: r.isError || undefined,
    })),
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
