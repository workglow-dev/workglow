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
  type McpServerConfig,
} from "@workglow/util";

const inputSchema = {
  type: "object",
  properties: {
    ...mcpServerConfigSchema,
    tool_name: {
      type: "string",
      title: "Tool Name",
      description: "The name of the tool to call",
    },
    tool_arguments: {
      type: "object",
      additionalProperties: true,
      title: "Tool Arguments",
      description: "Arguments to pass to the tool",
    },
  },
  required: ["transport", "tool_name"],
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

const toolContentSchema = {
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
    content: {
      type: "array",
      items: toolContentSchema,
      title: "Content",
      description: "The content returned by the tool",
    },
    isError: {
      type: "boolean",
      title: "Is Error",
      description: "Whether the tool call resulted in an error",
    },
  },
  required: ["content", "isError"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type McpToolCallTaskInput = FromSchema<typeof inputSchema>;
export type McpToolCallTaskOutput = FromSchema<typeof outputSchema>;

export class McpToolCallTask extends Task<McpToolCallTaskInput, McpToolCallTaskOutput, TaskConfig> {
  public static type = "McpToolCallTask";
  public static category = "MCP";
  public static title = "MCP Call Tool";
  public static description = "Calls a tool on an MCP server and returns the result";
  static readonly cacheable = false;

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  async execute(
    input: McpToolCallTaskInput,
    context: IExecuteContext
  ): Promise<McpToolCallTaskOutput> {
    const { client } = await mcpClientFactory.create(
      input as unknown as McpServerConfig,
      context.signal
    );
    try {
      const result = await client.callTool({
        name: input.tool_name as string,
        arguments: input.tool_arguments as Record<string, unknown> | undefined,
      });
      if (!("content" in result) || !Array.isArray(result.content)) {
        throw new Error("Expected tool result with content array");
      }
      return {
        content: result.content,
        isError: result.isError === true,
      };
    } finally {
      await client.close();
    }
  }
}

export const mcpToolCall = async (
  input: McpToolCallTaskInput,
  config: TaskConfig = {}
): Promise<McpToolCallTaskOutput> => {
  return new McpToolCallTask({}, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    mcpToolCall: CreateWorkflow<McpToolCallTaskInput, McpToolCallTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.mcpToolCall = CreateWorkflow(McpToolCallTask);
