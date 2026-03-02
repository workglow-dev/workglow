/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskRegistry } from "@workglow/task-graph";
import type { IExecuteContext } from "@workglow/task-graph";
import { getLogger } from "@workglow/util";
import type {
  AgentHooks,
  FunctionToolSource,
  McpToolSource,
  RegistryToolSource,
  ToolResult,
  ToolSource,
} from "./AgentTypes";
import { findToolSource } from "./AgentTypes";
import type { ToolCall, ToolDefinition } from "./ToolCallingTask";
import { taskTypesToTools } from "./ToolCallingTask";

// ========================================================================
// Tool source resolution
// ========================================================================

/**
 * Builds an array of ToolSources from the various input sources:
 * - `taskTools`: names of registered task types to expose as tools
 * - `tools`: pre-built ToolDefinition objects with optional custom executors
 * - `mcpServers`: MCP server configs with pre-discovered tools
 */
export function buildToolSources(options: {
  taskTools?: ReadonlyArray<string>;
  tools?: ReadonlyArray<
    ToolDefinition & {
      execute?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    }
  >;
  mcpServers?: ReadonlyArray<{
    transport: string;
    server_url?: string;
    command?: string;
    args?: ReadonlyArray<string>;
    env?: Readonly<Record<string, string>>;
    tools?: ReadonlyArray<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }>;
  }>;
}): ToolSource[] {
  const sources: ToolSource[] = [];

  // Registry-based tools
  if (options.taskTools && options.taskTools.length > 0) {
    const definitions = taskTypesToTools(options.taskTools);
    for (let i = 0; i < definitions.length; i++) {
      sources.push({
        type: "registry",
        definition: definitions[i],
        taskType: options.taskTools[i],
      } satisfies RegistryToolSource);
    }
  }

  // User-provided tools (with optional custom executors)
  if (options.tools) {
    for (const tool of options.tools) {
      if (tool.execute) {
        const { execute, ...definition } = tool;
        sources.push({
          type: "function",
          definition,
          execute,
        } satisfies FunctionToolSource);
      } else {
        const { execute: _, ...definition } = tool;
        sources.push({
          type: "function",
          definition,
          execute: async () => ({ error: `No executor registered for tool "${tool.name}"` }),
        } satisfies FunctionToolSource);
      }
    }
  }

  // MCP server tools (pre-discovered)
  if (options.mcpServers) {
    for (const server of options.mcpServers) {
      if (server.tools) {
        for (const tool of server.tools) {
          sources.push({
            type: "mcp",
            definition: {
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            },
            mcpConfig: {
              transport: server.transport,
              server_url: server.server_url,
              command: server.command,
              args: server.args,
              env: server.env,
            },
          } satisfies McpToolSource);
        }
      }
    }
  }

  return sources;
}

// ========================================================================
// Tool execution with hooks
// ========================================================================

/**
 * Executes a single tool call by dispatching to the appropriate handler
 * based on the tool source type. Applies beforeToolCall, afterToolCall,
 * and onToolError hooks when provided.
 */
export async function executeToolCall(
  toolCall: ToolCall,
  sources: ReadonlyArray<ToolSource>,
  context: IExecuteContext,
  hooks?: AgentHooks
): Promise<ToolResult> {
  const source = findToolSource(sources, toolCall.name);
  if (!source) {
    getLogger().warn(`AgentTask: Unknown tool "${toolCall.name}" — not found in tool sources`);
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      output: { error: `Unknown tool: ${toolCall.name}` },
      isError: true,
    };
  }

  // beforeToolCall hook — can deny or modify the call
  let effectiveCall = toolCall;
  if (hooks?.beforeToolCall) {
    const decision = await hooks.beforeToolCall(toolCall, source);
    if (decision.action === "deny") {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        output: { error: decision.reason ?? "Tool call denied by hook" },
        isError: true,
      };
    }
    if (decision.action === "modify") {
      effectiveCall = { ...toolCall, input: decision.input };
    }
  }

  try {
    let output: Record<string, unknown>;

    switch (source.type) {
      case "registry": {
        const ctor = TaskRegistry.all.get(source.taskType);
        if (!ctor) {
          throw new Error(`Task type "${source.taskType}" not found in TaskRegistry`);
        }
        const task = context.own(new ctor(effectiveCall.input, {} as any));
        output = (await task.run(effectiveCall.input)) ?? {};
        break;
      }
      case "mcp": {
        const McpToolCallTask = TaskRegistry.all.get("McpToolCallTask");
        if (!McpToolCallTask) {
          throw new Error(
            "McpToolCallTask not found in TaskRegistry — ensure @workglow/tasks is registered"
          );
        }
        const mcpTask = context.own(
          new McpToolCallTask(
            {},
            {
              transport: source.mcpConfig.transport,
              server_url: source.mcpConfig.server_url,
              command: source.mcpConfig.command,
              args: source.mcpConfig.args as string[] | undefined,
              env: source.mcpConfig.env as Record<string, string> | undefined,
              tool_name: effectiveCall.name,
            } as any
          )
        );
        output = (await mcpTask.run(effectiveCall.input)) ?? {};
        break;
      }
      case "function": {
        output = await source.execute(effectiveCall.input);
        break;
      }
    }

    let result: ToolResult = {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      output,
      isError: false,
    };

    // afterToolCall hook — can transform the result
    if (hooks?.afterToolCall) {
      result = await hooks.afterToolCall(toolCall, result);
    }

    return result;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // onToolError hook — can provide a fallback result
    if (hooks?.onToolError) {
      const action = await hooks.onToolError(toolCall, error);
      if (action.action === "result") {
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          output: action.output,
          isError: false,
        };
      }
    }

    getLogger().warn(`AgentTask: Tool "${toolCall.name}" failed: ${error.message}`);
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      output: { error: error.message },
      isError: true,
    };
  }
}

/**
 * Executes multiple tool calls with concurrency control.
 *
 * Uses the same shared-cursor worker pool pattern as IteratorTaskRunner:
 * spawns N workers that pull from a shared cursor until all items are
 * processed. Results are returned in the original order.
 *
 * @param maxConcurrency - Max parallel tool executions (default: 5)
 */
export async function executeToolCalls(
  toolCalls: Record<string, ToolCall>,
  sources: ReadonlyArray<ToolSource>,
  context: IExecuteContext,
  hooks?: AgentHooks,
  maxConcurrency: number = 5
): Promise<ToolResult[]> {
  const calls = Object.values(toolCalls);
  if (calls.length === 0) return [];

  const concurrency = Math.max(1, Math.min(maxConcurrency, calls.length));
  const results: ToolResult[] = new Array(calls.length);
  // Shared cursor is safe: JS is single-threaded, so the read + increment
  // between `const position = cursor` and `cursor += 1` cannot interleave
  // with another worker. Each worker only awaits after claiming its position.
  let cursor = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      if (context.signal.aborted) return;

      const position = cursor;
      cursor += 1;

      if (position >= calls.length) return;

      results[position] = await executeToolCall(calls[position], sources, context, hooks);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Checks whether a ToolCallingTask output contains any tool calls.
 */
export function hasToolCalls(toolCalls: Record<string, unknown> | undefined): boolean {
  return toolCalls !== undefined && Object.keys(toolCalls).length > 0;
}
