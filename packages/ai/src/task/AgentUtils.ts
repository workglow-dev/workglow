/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DataPorts, getTaskConstructors } from "@workglow/task-graph";
import type { IExecuteContext } from "@workglow/task-graph";
import { getLogger } from "@workglow/util";
import type { ServiceRegistry } from "@workglow/util";
import { findToolSource } from "./AgentTypes";
import type {
  AgentHooks,
  FunctionToolSource,
  RegistryToolSource,
  ToolResult,
  ToolSource,
} from "./AgentTypes";
import { taskTypesToTools } from "./ToolCallingTask";
import type { ToolDefinitionWithTaskType } from "./ToolCallingTask";
import type { ToolCall, ToolCalls, ToolDefinition } from "./ToolCallingUtils";

// ========================================================================
// Tool source resolution
// ========================================================================

/**
 * Builds an array of {@link ToolSource} entries from a unified tools list.
 *
 * Each entry is either:
 * - A **string** — resolved from the TaskRegistry via {@link taskTypesToTools}.
 * - A **{@link ToolDefinition}** object — dispatched based on its shape:
 *   - Has `execute` function → {@link FunctionToolSource}
 *   - Has a backing task in the task constructors (looked up by `name`) →
 *     {@link RegistryToolSource} with optional `config` passed through
 *   - Otherwise → {@link FunctionToolSource} that throws on invocation
 *
 * This mirrors the model resolution pattern: strings are convenient
 * shorthand, objects give full control (including `config` for
 * configurable tasks like `McpToolCallTask` or `JavaScriptTask`).
 *
 * The original order of entries in `tools` is preserved in the returned
 * sources array. An optional `registry` can be provided to use a
 * DI-scoped constructor map instead of the global TaskRegistry.
 */
export function buildToolSources(
  tools?: ReadonlyArray<string | ToolDefinition>,
  registry?: ServiceRegistry
): ToolSource[] {
  if (!tools || tools.length === 0) return [];

  // Pre-resolve all string names in one batch for efficiency, keyed by task type name.
  // Resolved eagerly so individual emits below remain O(1) lookups.
  const stringNames = tools.filter((t): t is string => typeof t === "string");
  const resolvedDefs = new Map<string, ToolDefinitionWithTaskType>(
    taskTypesToTools(stringNames, registry).map((d) => [d.taskType, d])
  );

  // Task constructors map for DI-scoped lookups on object entries
  const constructors = getTaskConstructors(registry);

  const sources: ToolSource[] = [];

  // Emit sources in the original tools array order
  for (const tool of tools) {
    if (typeof tool === "string") {
      // String entries are resolved via the batch lookup above
      const def = resolvedDefs.get(tool);
      if (def) {
        const { taskType, ...definition } = def;
        sources.push({
          type: "registry",
          definition,
          taskType,
        } satisfies RegistryToolSource);
      }
    } else if (tool.type === "function" || (!tool.type && tool.execute)) {
      // Explicit function type or has execute — use as custom executor
      if (!tool.execute) {
        getLogger().warn(
          `AgentTask: Tool "${tool.name}" has type "function" but no execute function — will throw on invocation`
        );
      }
      const { execute, configSchema: _cs, config: _c, type: _t, ...definition } = tool;
      sources.push({
        type: "function",
        definition,
        run:
          execute ??
          (async () => {
            throw new Error(`No execute function for tool "${tool.name}"`);
          }),
      } satisfies FunctionToolSource);
    } else if (tool.type === "task") {
      // Explicit task type — look up in registry
      const ctor = constructors.get(tool.name);
      if (!ctor) {
        getLogger().warn(
          `AgentTask: Tool "${tool.name}" has type "task" but is not in TaskRegistry — will throw on invocation`
        );
        const { execute: _e, configSchema: _cs, config: _c, type: _t, ...definition } = tool;
        sources.push({
          type: "function",
          definition,
          run: async () => {
            throw new Error(`Task "${tool.name}" not found in TaskRegistry`);
          },
        } satisfies FunctionToolSource);
      } else {
        const taskConfigSchema = (ctor as any).configSchema?.();
        const safeConfig =
          tool.config && taskConfigSchema
            ? tool.config
            : tool.config && !taskConfigSchema
              ? {}
              : tool.config;
        if (tool.config && !taskConfigSchema) {
          getLogger().warn(
            `AgentTask: Tool "${tool.name}" provided config but task has no configSchema — config ignored`
          );
        }
        const { execute: _e, configSchema: _cs, config: _c, type: _t, ...definition } = tool;
        sources.push({
          type: "registry",
          definition,
          taskType: tool.name,
          config: safeConfig,
        } satisfies RegistryToolSource);
      }
    } else {
      // No discriminator — duck-type: check if name matches a registered task
      const ctor = constructors.get(tool.name);
      if (ctor) {
        // Registry-backed tool — config is passed through for task instantiation.
        // Only pass config if the task actually declares a configSchema.
        const taskConfigSchema = (ctor as any).configSchema?.();
        const safeConfig =
          tool.config && taskConfigSchema
            ? tool.config
            : tool.config && !taskConfigSchema
              ? {}
              : tool.config;
        if (tool.config && !taskConfigSchema) {
          getLogger().warn(
            `AgentTask: Tool "${tool.name}" provided config but task has no configSchema — config ignored`
          );
        }
        const { execute: _e, configSchema: _cs, config: _c, type: _t, ...definition } = tool;
        sources.push({
          type: "registry",
          definition,
          taskType: tool.name,
          config: safeConfig,
        } satisfies RegistryToolSource);
      } else {
        // No executor and not in registry — create a stub that throws
        const { execute: _e, configSchema: _cs, config: _c, type: _t, ...definition } = tool;
        sources.push({
          type: "function",
          definition,
          run: async () => {
            throw new Error(`No executor registered for tool "${tool.name}"`);
          },
        } satisfies FunctionToolSource);
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
    let output: DataPorts;

    switch (source.type) {
      case "registry": {
        const ctor = getTaskConstructors(context.registry).get(source.taskType);
        if (!ctor) {
          throw new Error(`Task type "${source.taskType}" not found in TaskRegistry`);
        }
        const taskConfig = source.config ?? {};
        const task = context.own(new ctor({}, taskConfig));
        output = (await task.run(effectiveCall.input)) ?? {};
        break;
      }
      case "function": {
        output = await source.run(effectiveCall.input);
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
  toolCalls: ToolCalls,
  sources: ReadonlyArray<ToolSource>,
  context: IExecuteContext,
  hooks?: AgentHooks,
  maxConcurrency: number = 5
): Promise<ToolResult[]> {
  const calls = toolCalls;
  if (calls.length === 0) return [];

  const concurrency = Math.max(1, Math.min(maxConcurrency, calls.length));
  const results: ToolResult[] = new Array(calls.length);
  // Shared cursor is safe: JS is single-threaded, so the read + increment
  // between `const position = cursor` and `cursor += 1` cannot interleave
  // with another worker. Each worker only awaits after claiming its position.
  let cursor = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      if (context.signal.aborted) {
        throw context.signal.reason ?? new DOMException("The operation was aborted", "AbortError");
      }

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
export function hasToolCalls(toolCalls: unknown[] | undefined): boolean {
  return toolCalls !== undefined && toolCalls.length > 0;
}
