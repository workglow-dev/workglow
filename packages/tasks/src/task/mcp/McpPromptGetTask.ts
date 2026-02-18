/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import {
  DataPortSchema,
  FromSchema,
  mcpClientFactory,
  mcpServerConfigSchema,
} from "@workglow/util";

const inputSchema = {
  type: "object",
  properties: {
    ...mcpServerConfigSchema,
    prompt_name: {
      type: "string",
      title: "Prompt Name",
      description: "The name of the prompt to get",
    },
    prompt_arguments: {
      type: "object",
      additionalProperties: { type: "string" },
      title: "Prompt Arguments",
      description: "Arguments to pass to the prompt",
    },
  },
  required: ["transport", "prompt_name"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const annotationsSchema = {
  type: "object",
  properties: {
    audience: {
      type: "array",
      items: { type: "string", enum: ["user", "assistant"] },
    },
    priority: { type: "number" },
    lastModified: { type: "string" },
  },
  additionalProperties: false,
} as const;

const contentSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        type: { type: "string", const: "text" },
        text: { type: "string" },
        annotations: annotationsSchema,
        _meta: { type: "object", additionalProperties: true },
      },
      required: ["type", "text"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "image" },
        data: { type: "string" },
        mimeType: { type: "string" },
        annotations: annotationsSchema,
        _meta: { type: "object", additionalProperties: true },
      },
      required: ["type", "data", "mimeType"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "audio" },
        data: { type: "string" },
        mimeType: { type: "string" },
        annotations: annotationsSchema,
        _meta: { type: "object", additionalProperties: true },
      },
      required: ["type", "data", "mimeType"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "resource" },
        resource: {
          type: "object",
          properties: {
            uri: { type: "string" },
            text: { type: "string" },
            blob: { type: "string" },
            mimeType: { type: "string" },
            _meta: { type: "object", additionalProperties: true },
          },
          required: ["uri"],
          additionalProperties: false,
        },
        annotations: annotationsSchema,
        _meta: { type: "object", additionalProperties: true },
      },
      required: ["type", "resource"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "resource_link" },
        uri: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        mimeType: { type: "string" },
        annotations: annotationsSchema,
        icons: {
          type: "array",
          items: {
            type: "object",
            properties: {
              src: { type: "string" },
              mimeType: { type: "string" },
              sizes: { type: "array", items: { type: "string" } },
              theme: { type: "string", enum: ["light", "dark"] },
            },
            additionalProperties: false,
          },
        },
        title: { type: "string" },
        _meta: { type: "object", additionalProperties: true },
      },
      required: ["type", "uri", "name"],
      additionalProperties: false,
    },
  ],
} as const;

const outputSchema = {
  type: "object",
  properties: {
    messages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["user", "assistant"] },
          content: contentSchema,
        },
        required: ["role", "content"],
        additionalProperties: false,
      },
      title: "Messages",
      description: "The messages returned by the prompt",
    },
    description: {
      type: "string",
      title: "Description",
      description: "The description of the prompt",
    },
  },
  required: ["messages"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type McpPromptGetTaskInput = FromSchema<typeof inputSchema>;
export type McpPromptGetTaskOutput = FromSchema<typeof outputSchema>;

export class McpPromptGetTask extends Task<
  McpPromptGetTaskInput,
  McpPromptGetTaskOutput,
  TaskConfig
> {
  public static type = "McpPromptGetTask";
  public static category = "MCP";
  public static title = "MCP Get Prompt";
  public static description = "Gets a prompt from an MCP server";
  static readonly cacheable = false;

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  async execute(
    input: McpPromptGetTaskInput,
    context: IExecuteContext
  ): Promise<McpPromptGetTaskOutput> {
    const { client } = await mcpClientFactory.create(input, context.signal);
    try {
      const result = await client.getPrompt({
        name: input.prompt_name,
        arguments: input.prompt_arguments,
      });
      return {
        messages: result.messages,
        description: result.description,
      };
    } finally {
      await client.close();
    }
  }
}

export const mcpPromptGet = async (
  input: McpPromptGetTaskInput,
  config: TaskConfig = {}
): Promise<McpPromptGetTaskOutput> => {
  const result = await new McpPromptGetTask({}, config).run(input);
  return result;
};

declare module "@workglow/task-graph" {
  interface Workflow {
    mcpPromptGet: CreateWorkflow<McpPromptGetTaskInput, McpPromptGetTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.mcpPromptGet = CreateWorkflow(McpPromptGetTask);
