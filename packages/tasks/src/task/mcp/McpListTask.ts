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

const mcpListTypes = ["tools", "resources", "prompts"] as const;

const inputSchema = {
  type: "object",
  properties: {
    ...mcpServerConfigSchema,
    list_type: {
      type: "string",
      enum: mcpListTypes,
      title: "List Type",
      description: "The type of items to list from the MCP server",
    },
  },
  required: ["transport", "list_type"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const iconSchema = {
  type: "object",
  properties: {
    src: { type: "string" },
    mimeType: { type: "string" },
    sizes: { type: "array", items: { type: "string" } },
    theme: { type: "string", enum: ["light", "dark"] },
  },
  additionalProperties: false,
} as const;

const outputSchemaTools = {
  type: "object",
  properties: {
    tools: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          inputSchema: {
            type: "object",
            properties: {
              type: { type: "string" },
              properties: { type: "object", additionalProperties: true },
              required: { type: "array", items: { type: "string" } },
            },
            additionalProperties: true,
          },
          outputSchema: {
            type: "object",
            properties: {
              type: { type: "string" },
              properties: { type: "object", additionalProperties: true },
              required: { type: "array", items: { type: "string" } },
            },
            additionalProperties: true,
          },
          annotations: {
            type: "object",
            properties: {
              title: { type: "string" },
              readOnlyHint: { type: "boolean" },
              destructiveHint: { type: "boolean" },
              idempotentHint: { type: "boolean" },
              openWorldHint: { type: "boolean" },
            },
            additionalProperties: false,
          },
          execution: {
            type: "object",
            properties: {
              taskSupport: {
                type: "string",
                enum: ["optional", "required", "forbidden"],
              },
            },
            additionalProperties: false,
          },
          _meta: { type: "object", additionalProperties: true },
          icons: { type: "array", items: iconSchema },
          title: { type: "string" },
        },
        required: ["name", "inputSchema"],
        additionalProperties: false,
      },
      title: "Tools",
      description: "The tools available on the MCP server",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchemaResources = {
  type: "object",
  properties: {
    resources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          uri: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          mimeType: { type: "string" },
          annotations: {
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
          },
          _meta: { type: "object", additionalProperties: true },
          icons: { type: "array", items: iconSchema },
          title: { type: "string" },
        },
        required: ["uri", "name"],
        additionalProperties: false,
      },
      title: "Resources",
      description: "The resources available on the MCP server",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchemaPrompts = {
  type: "object",
  properties: {
    prompts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          arguments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                required: { type: "boolean" },
              },
              required: ["name"],
              additionalProperties: false,
            },
          },
          _meta: { type: "object", additionalProperties: true },
          icons: { type: "array", items: iconSchema },
          title: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
      title: "Prompts",
      description: "The prompts available on the MCP server",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchemaAll = {
  type: "object",
  properties: {
    ...outputSchemaTools.properties,
    ...outputSchemaResources.properties,
    ...outputSchemaPrompts.properties,
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type McpListTaskInput = FromSchema<typeof inputSchema>;
export type McpListTaskOutput = FromSchema<typeof outputSchemaAll>;

export class McpListTask extends Task<McpListTaskInput, McpListTaskOutput, TaskConfig> {
  public static type = "McpListTask";
  public static category = "MCP";
  public static title = "MCP List";
  public static description = "Lists tools, resources, or prompts available on an MCP server";
  static readonly cacheable = false;
  public static hasDynamicSchemas: boolean = true;

  public static inputSchema() {
    return inputSchema;
  }

  public static outputSchema() {
    return outputSchemaAll;
  }

  public override outputSchema(): DataPortSchema {
    const listType = this.runInputData?.list_type ?? this.defaults?.list_type ?? null;

    if (listType === null || listType === undefined) {
      return outputSchemaAll;
    }

    switch (listType) {
      case "tools":
        return outputSchemaTools;
      case "resources":
        return outputSchemaResources;
      case "prompts":
        return outputSchemaPrompts;
      default:
        return outputSchemaAll;
    }
  }

  public override setInput(input: Record<string, unknown>): void {
    if (!("list_type" in input)) {
      super.setInput(input);
      return;
    }

    const previousListType = this.runInputData?.list_type ?? this.defaults?.list_type ?? null;
    super.setInput(input);
    const newListType = this.runInputData?.list_type ?? this.defaults?.list_type ?? null;

    if (previousListType !== newListType) {
      this.emitSchemaChange();
    }
  }

  async execute(input: McpListTaskInput, context: IExecuteContext): Promise<McpListTaskOutput> {
    const { client } = await mcpClientFactory.create(
      input as unknown as McpServerConfig,
      context.signal
    );
    try {
      switch (input.list_type) {
        case "tools": {
          const result = await client.listTools();
          return { tools: result.tools };
        }
        case "resources": {
          const result = await client.listResources();
          return { resources: result.resources };
        }
        case "prompts": {
          const result = await client.listPrompts();
          return { prompts: result.prompts };
        }
        default:
          throw new Error(`Unsupported list type: ${input.list_type}`);
      }
    } finally {
      await client.close();
    }
  }
}

export const mcpList = async (
  input: McpListTaskInput,
  config: TaskConfig = {}
): Promise<McpListTaskOutput> => {
  return new McpListTask({}, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    mcpList: CreateWorkflow<McpListTaskInput, McpListTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.mcpList = CreateWorkflow(McpListTask);
