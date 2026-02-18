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
    resource_uri: {
      type: "string",
      title: "Resource URI",
      description: "The URI of the resource to read",
    },
  },
  required: ["transport", "resource_uri"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

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

export type McpResourceReadTaskInput = FromSchema<typeof inputSchema>;
export type McpResourceReadTaskOutput = FromSchema<typeof outputSchema>;

export class McpResourceReadTask extends Task<
  McpResourceReadTaskInput,
  McpResourceReadTaskOutput,
  TaskConfig
> {
  public static type = "McpResourceReadTask";
  public static category = "MCP";
  public static title = "MCP Read Resource";
  public static description = "Reads a resource from an MCP server";
  static readonly cacheable = false;

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchema;
  }

  async execute(
    input: McpResourceReadTaskInput,
    context: IExecuteContext
  ): Promise<McpResourceReadTaskOutput> {
    const { client } = await mcpClientFactory.create(
      input as unknown as McpServerConfig,
      context.signal
    );
    try {
      const result = await client.readResource({ uri: input.resource_uri });
      return { contents: result.contents };
    } finally {
      await client.close();
    }
  }
}

export const mcpResourceRead = async (
  input: McpResourceReadTaskInput,
  config: TaskConfig = {}
): Promise<McpResourceReadTaskOutput> => {
  return new McpResourceReadTask({}, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    mcpResourceRead: CreateWorkflow<
      McpResourceReadTaskInput,
      McpResourceReadTaskOutput,
      TaskConfig
    >;
  }
}

Workflow.prototype.mcpResourceRead = CreateWorkflow(McpResourceReadTask);
