/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  Task,
  Workflow,
  type IExecuteContext,
  type StreamEvent,
  type TaskConfig,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util";
import { getLogger } from "@workglow/util";
import type { AgentHooks, ChatMessage, ToolSource } from "./AgentTypes";
import { assistantMessage, toolMessage, toolSourceDefinitions, userMessage } from "./AgentTypes";
import { buildToolSources, executeToolCalls, hasToolCalls } from "./AgentUtils";
import { TypeModel } from "./base/AiTaskSchemas";
import type { ToolCall, ToolCallingTaskInput, ToolDefinition } from "./ToolCallingTask";
import { ToolCallingTask } from "./ToolCallingTask";

// ========================================================================
// Config
// ========================================================================

export interface AgentTaskConfig extends TaskConfig {
  /** Lifecycle hooks for intercepting the agent loop. */
  readonly hooks?: AgentHooks;
  /** Max concurrent tool executions per iteration (default: 5). */
  readonly maxConcurrency?: number;
}

// ========================================================================
// Input / Output types
// ========================================================================

/**
 * Input for the AgentTask. The JSON Schema ({@link AgentInputSchema}) is
 * used for runtime validation and UI; this interface is the TypeScript
 * source of truth.
 */
export interface AgentTaskInput {
  readonly [key: string]: unknown;
  readonly model: string;
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly tools?: ReadonlyArray<
    ToolDefinition & {
      execute?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    }
  >;
  readonly taskTools?: ReadonlyArray<string>;
  readonly mcpServers?: ReadonlyArray<{
    readonly transport: string;
    readonly server_url?: string;
    readonly command?: string;
    readonly args?: ReadonlyArray<string>;
    readonly env?: Readonly<Record<string, string>>;
    readonly tools?: ReadonlyArray<{
      readonly name: string;
      readonly description: string;
      readonly inputSchema: Record<string, unknown>;
    }>;
  }>;
  readonly maxIterations?: number;
  readonly maxTokens?: number;
  readonly temperature?: number;
  /**
   * Name of a "stop tool". When the LLM calls this tool the agent loop
   * ends and the tool's input becomes the {@link AgentTaskOutput.structuredOutput}.
   * If no tool source with this name exists, a synthetic definition is
   * added automatically.
   */
  readonly stopTool?: string;
  /**
   * Maximum number of messages to keep in the conversation window sent
   * to the LLM. When exceeded, the oldest messages (after the initial
   * user message) are dropped. Helps prevent context-window overflow.
   */
  readonly maxContextMessages?: number;
}

export interface AgentTaskOutput {
  readonly [key: string]: unknown;
  readonly text: string;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly iterations: number;
  readonly toolCallCount: number;
  /** Present when the agent terminated via a stop tool. */
  readonly structuredOutput?: Record<string, unknown>;
}

// ========================================================================
// Schemas
// ========================================================================

const modelSchema = TypeModel("model:ToolCallingTask");

export const AgentInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
    prompt: {
      type: "string",
      title: "Prompt",
      description: "The user prompt to start the agent loop",
    },
    systemPrompt: {
      type: "string",
      title: "System Prompt",
      description: "Optional system instructions for the agent",
    },
    tools: {
      type: "array",
      title: "Tools",
      description: "Tool definitions with optional custom executors",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          inputSchema: { type: "object", additionalProperties: true },
          outputSchema: { type: "object", additionalProperties: true },
        },
        required: ["name", "description", "inputSchema"],
        additionalProperties: true,
      },
    },
    taskTools: {
      type: "array",
      title: "Task Tools",
      description: "Names of registered task types to expose as tools",
      items: { type: "string" },
    },
    mcpServers: {
      type: "array",
      title: "MCP Servers",
      description: "MCP server configurations with pre-discovered tools",
      items: {
        type: "object",
        additionalProperties: true,
      },
    },
    stopTool: {
      type: "string",
      title: "Stop Tool",
      description:
        "Name of a tool that signals agent completion. When called, the loop ends and the tool input becomes structuredOutput.",
      "x-ui-group": "Configuration",
    },
    maxIterations: {
      type: "number",
      title: "Max Iterations",
      description: "Maximum number of agent loop iterations (default: 10)",
      minimum: 1,
      "x-ui-group": "Configuration",
    },
    maxContextMessages: {
      type: "number",
      title: "Max Context Messages",
      description:
        "Maximum messages in conversation history. Older messages are trimmed to prevent context overflow.",
      minimum: 3,
      "x-ui-group": "Configuration",
    },
    maxTokens: {
      type: "number",
      title: "Max Tokens",
      description: "Maximum tokens per LLM call",
      minimum: 1,
      "x-ui-group": "Configuration",
    },
    temperature: {
      type: "number",
      title: "Temperature",
      description: "Sampling temperature for LLM calls",
      minimum: 0,
      maximum: 2,
      "x-ui-group": "Configuration",
    },
  },
  required: ["model", "prompt"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const AgentOutputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The final text response from the agent",
      "x-stream": "append",
    },
    messages: {
      type: "array",
      title: "Messages",
      description: "Full conversation history including all tool calls and results",
      items: {
        type: "object",
        additionalProperties: true,
      },
    },
    iterations: {
      type: "number",
      title: "Iterations",
      description: "Number of LLM calls made during the agent loop",
    },
    toolCallCount: {
      type: "number",
      title: "Tool Call Count",
      description: "Total number of tool calls executed",
    },
    structuredOutput: {
      type: "object",
      title: "Structured Output",
      description: "Present when the agent terminated via a stop tool",
      additionalProperties: true,
    },
  },
  required: ["text", "messages", "iterations", "toolCallCount"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

// ========================================================================
// AgentTask — multi-turn agentic loop orchestrator
// ========================================================================

export class AgentTask extends Task<AgentTaskInput, AgentTaskOutput, AgentTaskConfig> {
  public static type = "AgentTask";
  public static category = "AI Agent";
  public static title = "Agent";
  public static description =
    "Multi-turn agentic loop that calls an LLM with tools, executes tool calls, and iterates until done";
  public static cacheable = false;

  public static inputSchema(): DataPortSchema {
    return AgentInputSchema as DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return AgentOutputSchema as DataPortSchema;
  }

  // ====================================================================
  // Non-streaming execution — consumes the loop generator silently
  // ====================================================================

  async execute(input: AgentTaskInput, context: IExecuteContext): Promise<AgentTaskOutput> {
    let result: AgentTaskOutput | undefined;
    for await (const event of this.agentLoop(input, context)) {
      if (event.type === "finish") {
        result = event.data;
      }
    }
    if (!result) {
      throw new Error("AgentTask: loop ended without producing output");
    }
    return result;
  }

  // ====================================================================
  // Streaming execution — yields text deltas and the finish event
  // ====================================================================

  async *executeStream(
    input: AgentTaskInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<AgentTaskOutput>> {
    yield* this.agentLoop(input, context);
  }

  // ====================================================================
  // Core agent loop — single implementation used by both modes
  // ====================================================================

  private async *agentLoop(
    input: AgentTaskInput,
    context: IExecuteContext
  ): AsyncGenerator<StreamEvent<AgentTaskOutput>> {
    const maxIterations = input.maxIterations ?? 10;
    const hooks = this.config.hooks;
    const maxConcurrency = this.config.maxConcurrency ?? 5;

    const toolSources = this.resolveToolSources(input);
    const toolDefs = this.resolveToolDefs(toolSources, input.stopTool);

    const messages: ChatMessage[] = [userMessage(input.prompt)];
    let totalToolCalls = 0;
    let finalText = "";
    let structuredOutput: Record<string, unknown> | undefined;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (context.signal.aborted) break;

      // onIteration hook
      if (hooks?.onIteration) {
        const action = await hooks.onIteration(iteration, messages, { totalToolCalls });
        if (action.action === "stop") break;
      }

      await context.updateProgress(
        Math.round((iteration / maxIterations) * 100),
        `Agent iteration ${iteration + 1}`
      );

      // Trim context window if needed
      const contextMessages = this.trimMessages(messages, input.maxContextMessages);

      // Call the LLM and stream its output
      const llmTask = context.own(new ToolCallingTask({}, {}));
      let iterationText = "";
      const toolCalls: Record<string, ToolCall> = {};

      for await (const event of llmTask.executeStream(
        {
          model: input.model,
          prompt: input.prompt,
          systemPrompt: input.systemPrompt,
          tools: toolDefs as ToolCallingTaskInput["tools"],
          messages: contextMessages as ToolCallingTaskInput["messages"],
          maxTokens: input.maxTokens,
          temperature: input.temperature,
        },
        context
      )) {
        if (event.type === "text-delta") {
          yield { type: "text-delta", port: "text", textDelta: event.textDelta };
          iterationText += event.textDelta;
        } else if (event.type === "finish") {
          const data = event.data as Record<string, unknown> | undefined;
          iterationText = (data?.text as string) ?? iterationText;
          if (data?.toolCalls) {
            Object.assign(toolCalls, data.toolCalls);
          }
        }
      }

      finalText = iterationText;
      messages.push(assistantMessage(iterationText, toolCalls));

      // Check for stop tool — if the LLM called the stop tool alongside
      // other tools, we intentionally skip executing the sibling calls and
      // end the loop immediately. The stop tool signals task completion.
      if (input.stopTool) {
        const stopCall = Object.values(toolCalls).find((tc) => tc.name === input.stopTool);
        if (stopCall) {
          structuredOutput = stopCall.input;
          break;
        }
      }

      // If no tool calls, the agent is done
      if (!hasToolCalls(toolCalls)) {
        break;
      }

      // Execute tool calls with concurrency control and hooks
      const results = await executeToolCalls(
        toolCalls,
        toolSources,
        context,
        hooks,
        maxConcurrency
      );
      totalToolCalls += results.length;
      messages.push(toolMessage(results));
    }

    const output: AgentTaskOutput = {
      text: finalText,
      messages,
      iterations: messages.filter((m) => m.role === "assistant").length,
      toolCallCount: totalToolCalls,
      ...(structuredOutput !== undefined ? { structuredOutput } : {}),
    };

    yield { type: "finish", data: output };
  }

  // ====================================================================
  // Helpers
  // ====================================================================

  private resolveToolSources(input: AgentTaskInput): ToolSource[] {
    return buildToolSources({
      taskTools: input.taskTools,
      tools: input.tools,
      mcpServers: input.mcpServers,
    });
  }

  /**
   * Build the tool definitions to send to the LLM.
   * If a stopTool is configured and no matching source exists, adds a
   * synthetic tool definition so the LLM can call it.
   */
  private resolveToolDefs(
    toolSources: ReadonlyArray<ToolSource>,
    stopTool: string | undefined
  ): ToolDefinition[] {
    const defs = toolSourceDefinitions(toolSources);

    if (stopTool && !defs.some((d) => d.name === stopTool)) {
      defs.push({
        name: stopTool,
        description:
          "Call this tool when you have completed the task. Pass your final structured result as the input.",
        inputSchema: { type: "object", additionalProperties: true },
      });
    }

    return defs;
  }

  /**
   * Trim messages to stay within maxContextMessages.
   * Keeps the first message (initial user prompt) and the most recent
   * messages. Trims at assistant/tool pair boundaries so that a
   * tool_use message is never separated from its tool_result message.
   */
  private trimMessages(
    messages: ReadonlyArray<ChatMessage>,
    maxContextMessages: number | undefined
  ): ReadonlyArray<ChatMessage> {
    if (!maxContextMessages || messages.length <= maxContextMessages) {
      return messages;
    }

    getLogger().debug(
      `AgentTask: Trimming context from ${messages.length} to ${maxContextMessages} messages`
    );

    // Walk backwards from the end to find the earliest message we can keep
    // while respecting the limit. Never split an assistant+tool pair: if
    // the cut point lands on a "tool" message, include the preceding
    // "assistant" message as well.
    const tail = messages.slice(1); // everything after the initial user prompt
    let startIdx = tail.length - (maxContextMessages - 1);
    if (startIdx < 0) startIdx = 0;

    // If the cut starts on a tool message, back up to include its assistant
    if (startIdx > 0 && startIdx < tail.length && tail[startIdx].role === "tool") {
      startIdx -= 1;
    }

    return [messages[0], ...tail.slice(startIdx)];
  }
}

// ========================================================================
// Convenience function
// ========================================================================

export const agent = (input: AgentTaskInput, config?: AgentTaskConfig) => {
  return new AgentTask({} as AgentTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    agent: CreateWorkflow<AgentTaskInput, AgentTaskOutput, AgentTaskConfig>;
  }
}

Workflow.prototype.agent = CreateWorkflow(AgentTask);
