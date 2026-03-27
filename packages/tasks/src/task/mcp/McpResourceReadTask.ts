/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecuteContext,
  Task,
  TaskConfig,
  TaskConfigSchema,
  Workflow,
} from "@workglow/task-graph";
import { getMcpTaskDeps, type McpServerConfig } from "../../util/McpTaskDeps";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { getMcpServerConfig } from "../../mcp-server/getMcpServerConfig";

const contentItemSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        uri: { type: "string" },
        text: { type: "string" },
        mimeType: { type: "string" },
        _meta: { type: "object", additionalProperties: true },
      },
      required: ["uri", "text"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        uri: { type: "string" },
        blob: { type: "string" },
        mimeType: { type: "string" },
        _meta: { type: "object", additionalProperties: true },
      },
      required: ["uri", "blob"],
      additionalProperties: false,
    },
  ],
} as const;

const inputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    contents: {
      type: "array",
      items: contentItemSchema,
      title: "Contents",
      description: "The contents of the resource",
    },
  },
  required: ["contents"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type McpResourceReadTaskConfig = TaskConfig & Record<string, unknown>;
export type McpResourceReadTaskInput = FromSchema<typeof inputSchema>;
export type McpResourceReadTaskOutput = FromSchema<typeof outputSchema>;

export class McpResourceReadTask extends Task<
  McpResourceReadTaskInput,
  McpResourceReadTaskOutput,
  McpResourceReadTaskConfig
> {
  public static type = "McpResourceReadTask";
  public static category = "MCP";
  public static title = "MCP Read Resource";
  public static description = "Reads a resource from an MCP server";
  static readonly cacheable = false;
  public static customizable = true;

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  public static configSchema(): DataPortSchema {
    const { mcpServerConfigSchema } = getMcpTaskDeps();
    return {
      type: "object",
      properties: {
        ...TaskConfigSchema["properties"],
        server: {
          oneOf: [
            { type: "string", format: "mcp-server" },
            {
              type: "object",
              format: "mcp-server",
              properties: mcpServerConfigSchema.properties,
              additionalProperties: false,
            },
          ],
          title: "Server",
          description: "MCP server reference (ID or inline config)",
        },
        ...mcpServerConfigSchema.properties,
        resource_uri: {
          type: "string",
          title: "Resource URI",
          description: "The URI of the resource to read",
          format: "string:uri:mcp-resourceuri",
        },
      },
      required: ["resource_uri"],
      allOf: [
        ...(mcpServerConfigSchema.allOf ?? []),
        {
          anyOf: [
            { required: ["server"] },
            { required: ["transport"] },
          ],
        },
      ],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(
    _input: McpResourceReadTaskInput,
    context: IExecuteContext
  ): Promise<McpResourceReadTaskOutput> {
    const serverConfig = getMcpServerConfig(
      this.config as Record<string, unknown>
    );

    const { mcpClientFactory } = getMcpTaskDeps();
    const { client } = await mcpClientFactory.create(serverConfig, context.signal);
    try {
      const result = await client.readResource({
        uri: String(this.config.resource_uri ?? ""),
      });
      return { contents: result.contents };
    } finally {
      await client.close();
    }
  }
}

export const mcpResourceRead = async (
  config: McpResourceReadTaskConfig
): Promise<McpResourceReadTaskOutput> => {
  return new McpResourceReadTask({}, config).run({});
};

declare module "@workglow/task-graph" {
  interface Workflow {
    mcpResourceRead: CreateWorkflow<
      McpResourceReadTaskInput,
      McpResourceReadTaskOutput,
      McpResourceReadTaskConfig
    >;
  }
}

Workflow.prototype.mcpResourceRead = CreateWorkflow(McpResourceReadTask);
