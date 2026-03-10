/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  getTaskConstructors,
  JobQueueTaskConfig,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema, getLogger, JsonSchema, ServiceRegistry } from "@workglow/util";
import { TypeModel, TypeSingleOrArray } from "./base/AiTaskSchemas";
import { StreamingAiTask } from "./base/StreamingAiTask";

// ========================================================================
// Tool definition types
// ========================================================================

/**
 * A tool definition that can be passed to an LLM for tool calling.
 * Can be created manually or generated from TaskRegistry entries via {@link taskTypesToTools}.
 *
 * The `name` is used both as the tool name presented to the LLM and as a
 * lookup key for the backing Task in the TaskRegistry. When a tool is
 * backed by a configurable task (e.g. `McpToolCallTask`, `JavaScriptTask`),
 * `configSchema` describes what configuration the task accepts and `config`
 * provides the concrete values. The LLM never sees `configSchema` or
 * `config` — they are setup-time concerns used when instantiating the task.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  /** JSON Schema describing the task's configuration options. */
  configSchema?: JsonSchema;
  /** Concrete configuration values matching {@link configSchema}. */
  config?: Record<string, unknown>;
  /**
   * Optional custom executor function. When provided, the tool is executed
   * by calling this function directly instead of instantiating a Task.
   */
  execute?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/**
 * A tool call returned by the LLM, requesting invocation of a specific tool.
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
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

export interface ToolDefinitionWithTaskType extends ToolDefinition {
  /** The task type name this definition was generated from. */
  readonly taskType: string;
}

/**
 * Converts an allow-list of task type names into {@link ToolDefinitionWithTaskType} objects
 * suitable for the ToolCallingTask input. Each entry carries the originating
 * `taskType` so callers don't need to rely on index correspondence.
 *
 * Each task's `type`, `description`, `inputSchema()`, and `outputSchema()`
 * are used to build the tool definition.
 *
 * @param taskNames - Array of task type names registered in the task constructors
 * @param registry - Optional service registry for DI-based lookups
 * @returns Array of ToolDefinitionWithTaskType objects
 * @throws Error if a task name is not found in the registry
 */
export function taskTypesToTools(
  taskNames: ReadonlyArray<string>,
  registry?: ServiceRegistry
): ToolDefinitionWithTaskType[] {
  const constructors = getTaskConstructors(registry);
  return taskNames.map((name) => {
    const ctor = constructors.get(name);
    if (!ctor) {
      throw new Error(
        `taskTypesToTools: Unknown task type "${name}" — not found in task constructors registry (ServiceRegistry: ${registry ? "custom" : "default"})`
      );
    }
    const configSchema =
      "configSchema" in ctor && typeof (ctor as any).configSchema === "function"
        ? (ctor as any).configSchema()
        : undefined;
    return {
      name: ctor.type,
      description: (ctor as any).description ?? "",
      inputSchema: ctor.inputSchema(),
      outputSchema: ctor.outputSchema(),
      ...(configSchema ? { configSchema } : {}),
      taskType: name,
    };
  });
}

// ========================================================================
// Schemas
// ========================================================================

export const ToolDefinitionSchema = {
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
    configSchema: {
      type: "object",
      title: "Config Schema",
      description: "JSON Schema describing the task's configuration options (not sent to the LLM)",
      additionalProperties: true,
    },
    config: {
      type: "object",
      title: "Config",
      description: "Concrete configuration values for the backing task (not sent to the LLM)",
      additionalProperties: true,
    },
  },
  required: ["name", "description", "inputSchema"],
  additionalProperties: true,
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
      oneOf: [
        { type: "string", title: "Prompt", description: "The prompt to send to the model" },
        {
          type: "array",
          title: "Prompt",
          description: "The prompt as an array of strings or content blocks",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["text", "image", "audio"] },
                },
                required: ["type"],
                additionalProperties: true,
              },
            ],
          },
        },
      ],
      title: "Prompt",
      description: "The prompt to send to the model",
    },
    systemPrompt: {
      type: "string",
      title: "System Prompt",
      description: "Optional system instructions for the model",
    },
    messages: {
      type: "array",
      title: "Messages",
      description:
        "Full conversation history for multi-turn interactions. When provided, used instead of prompt to construct the messages array sent to the provider.",
      items: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["user", "assistant", "tool"] },
          content: {},
        },
        required: ["role", "content"],
        additionalProperties: true,
      },
    },
    tools: {
      type: "array",
      format: "tasks",
      title: "Tools",
      description: "Tool definitions available for the model to call",
      items: {
        oneOf: [
          { type: "string", format: "tasks", description: "Task type name" },
          ToolDefinitionSchema,
        ],
      },
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
    text: TypeSingleOrArray({
      type: "string",
      title: "Text",
      description: "Any text content generated by the model",
      "x-stream": "append",
    }),
    toolCalls: TypeSingleOrArray({
      ...ToolCallSchema,
      "x-stream": "object",
    }),
  },
  required: ["text", "toolCalls"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

/**
 * Runtime input type for ToolCallingTask.
 *
 * The schema uses `oneOf: [string, object]` so the UI can accept both task-name
 * references and inline tool definitions, but the input resolver converts all
 * strings to {@link ToolDefinition} objects before execution. The `tools` field
 * is therefore narrowed to `ToolDefinition[]` here.
 *
 * Extends the schema-derived base with the
 * `messages` field typed explicitly (the loose `content: {}` in the
 * schema prevents `FromSchema` from producing a useful type).
 */
export type ToolCallingTaskInput = Omit<FromSchema<typeof ToolCallingInputSchema>, "tools"> & {
  readonly tools: ToolDefinition[];
  readonly messages?: ReadonlyArray<{
    readonly role: "user" | "assistant" | "tool";
    readonly content: unknown;
  }>;
};

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
