/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, JobQueueTaskConfig, TaskRegistry, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema, getLogger, JsonSchema } from "@workglow/util";
import { TypeModel } from "./base/AiTaskSchemas";
import { StreamingAiTask } from "./base/StreamingAiTask";

// ========================================================================
// Tool definition types
// ========================================================================

/**
 * A tool definition that can be passed to an LLM for tool calling.
 * Can be created manually or generated from TaskRegistry entries via {@link taskTypesToTools}.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema?: JsonSchema;
}

/**
 * A tool call returned by the LLM, requesting invocation of a specific tool.
 */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/**
 * Controls which tools the model may call.
 * - `"auto"` — model decides whether to call tools
 * - `"none"` — model must not call any tools
 * - `"required"` — model must call at least one tool
 * - any other string — model must call the tool with that name
 */
export type ToolChoiceOption = "auto" | "none" | "required" | (string & {});

// ========================================================================
// Shared provider utilities
// ========================================================================

/**
 * Builds a tool description string for provider APIs, appending the output
 * schema when present. Shared across all provider implementations.
 */
export function buildToolDescription(tool: ToolDefinition): string {
  let desc = tool.description;
  if (tool.outputSchema && typeof tool.outputSchema === "object") {
    desc += `\n\nReturns: ${JSON.stringify(tool.outputSchema)}`;
  }
  return desc;
}

/**
 * Validates that a tool call name returned by the LLM matches one of the
 * allowed tool definitions. Returns true if valid, false otherwise.
 */
export function isAllowedToolName(
  name: string,
  allowedTools: ReadonlyArray<ToolDefinition>
): boolean {
  return allowedTools.some((t) => t.name === name);
}

/**
 * Filters a Record of tool calls, removing any whose name does not appear
 * in the provided tools list. Returns the filtered Record.
 */
export function filterValidToolCalls(
  toolCalls: Record<string, unknown>,
  allowedTools: ReadonlyArray<ToolDefinition>
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(toolCalls)) {
    const tc = value as { name?: string };
    if (tc.name && isAllowedToolName(tc.name, allowedTools)) {
      filtered[key] = value;
    } else {
      getLogger().warn(`Filtered out tool call with unknown name "${tc.name ?? "(missing)"}"`, {
        callId: key,
        toolName: tc.name,
      });
    }
  }
  return filtered;
}

// ========================================================================
// Utility: convert TaskRegistry entries to tool definitions
// ========================================================================

/**
 * Converts an allow-list of task type names from the {@link TaskRegistry}
 * into {@link ToolDefinition} objects suitable for the ToolCallingTask input.
 *
 * Each task's `type`, `description`, `inputSchema()`, and `outputSchema()`
 * are used to build the tool definition.
 *
 * @param taskNames - Array of task type names registered in TaskRegistry
 * @returns Array of ToolDefinition objects
 * @throws Error if a task name is not found in the registry
 */
export function taskTypesToTools(taskNames: ReadonlyArray<string>): ToolDefinition[] {
  return taskNames.map((name) => {
    const ctor = TaskRegistry.all.get(name);
    if (!ctor) {
      throw new Error(`taskTypesToTools: Unknown task type "${name}" — not found in TaskRegistry`);
    }
    return {
      name: ctor.type,
      description: (ctor as any).description ?? "",
      inputSchema: ctor.inputSchema(),
      outputSchema: ctor.outputSchema(),
    };
  });
}

// ========================================================================
// Schemas
// ========================================================================

const ToolDefinitionSchema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      title: "Name",
      description: "The tool name",
    },
    description: {
      type: "string",
      title: "Description",
      description: "A description of what the tool does",
    },
    inputSchema: {
      type: "object",
      title: "Input Schema",
      description: "JSON Schema describing the tool's input parameters",
      additionalProperties: true,
    },
    outputSchema: {
      type: "object",
      title: "Output Schema",
      description: "JSON Schema describing what the tool returns",
      additionalProperties: true,
    },
  },
  required: ["name", "description", "inputSchema"],
  additionalProperties: false,
} as const;

const ToolCallSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      title: "ID",
      description: "Unique identifier for this tool call",
    },
    name: {
      type: "string",
      title: "Name",
      description: "The name of the tool to invoke",
    },
    input: {
      type: "object",
      title: "Input",
      description: "The input arguments for the tool call",
      additionalProperties: true,
    },
  },
  required: ["id", "name", "input"],
  additionalProperties: false,
} as const;

const modelSchema = TypeModel("model:ToolCallingTask");

export const ToolCallingInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
    prompt: {
      type: "string",
      title: "Prompt",
      description: "The prompt to send to the model",
    },
    systemPrompt: {
      type: "string",
      title: "System Prompt",
      description: "Optional system instructions for the model",
    },
    tools: {
      type: "array",
      title: "Tools",
      description: "Tool definitions available for the model to call",
      items: ToolDefinitionSchema,
    },
    toolChoice: {
      type: "string",
      title: "Tool Choice",
      description:
        'Controls tool selection: "auto" (model decides), "none" (no tools), "required" (must call a tool), or a specific tool name',
      "x-ui-group": "Configuration",
    },
    maxTokens: {
      type: "number",
      title: "Max Tokens",
      description: "The maximum number of tokens to generate",
      minimum: 1,
      "x-ui-group": "Configuration",
    },
    temperature: {
      type: "number",
      title: "Temperature",
      description: "The temperature to use for sampling",
      minimum: 0,
      maximum: 2,
      "x-ui-group": "Configuration",
    },
  },
  required: ["model", "prompt", "tools"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const ToolCallingOutputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "Any text content generated by the model",
      "x-stream": "append",
    },
    toolCalls: {
      type: "object",
      title: "Tool Calls",
      description: "Tool invocations requested by the model, keyed by call id",
      additionalProperties: true,
      "x-stream": "object",
    },
  },
  required: ["text", "toolCalls"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ToolCallingTaskInput = FromSchema<typeof ToolCallingInputSchema>;
export type ToolCallingTaskOutput = FromSchema<typeof ToolCallingOutputSchema>;

// ========================================================================
// Task class
// ========================================================================

export class ToolCallingTask extends StreamingAiTask<
  ToolCallingTaskInput,
  ToolCallingTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "ToolCallingTask";
  public static category = "AI Text Model";
  public static title = "Tool Calling";
  public static description =
    "Sends a prompt with tool definitions to a language model and returns text along with any tool calls the model requests";
  public static inputSchema(): DataPortSchema {
    return ToolCallingInputSchema as DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return ToolCallingOutputSchema as DataPortSchema;
  }
}

/**
 * Convenience function to run a tool calling task.
 */
export const toolCalling = (input: ToolCallingTaskInput, config?: JobQueueTaskConfig) => {
  return new ToolCallingTask({} as ToolCallingTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    toolCalling: CreateWorkflow<ToolCallingTaskInput, ToolCallingTaskOutput, JobQueueTaskConfig>;
  }
}

Workflow.prototype.toolCalling = CreateWorkflow(ToolCallingTask);
