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
import { mcpList, type McpListTaskInput } from "./McpListTask";
import { getMcpServerConfig } from "../../mcp-server/getMcpServerConfig";

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

const fallbackOutputSchema = {
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

const fallbackInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type McpPromptGetTaskConfig = TaskConfig & Record<string, unknown>;
export type McpPromptGetTaskInput = Record<string, unknown>;
export type McpPromptGetTaskOutput = FromSchema<typeof fallbackOutputSchema>;

export class McpPromptGetTask extends Task<
  McpPromptGetTaskInput,
  McpPromptGetTaskOutput,
  McpPromptGetTaskConfig
> {
  public static type = "McpPromptGetTask";
  public static category = "MCP";
  public static title = "MCP Get Prompt";
  public static description = "Gets a prompt from an MCP server";
  static readonly cacheable = false;
  public static customizable = true;
  public static hasDynamicSchemas = true;

  public static inputSchema() {
    return fallbackInputSchema;
  }

  public static outputSchema() {
    return fallbackOutputSchema;
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
        prompt_name: {
          type: "string",
          title: "Prompt Name",
          description: "The name of the prompt to get",
          format: "string:mcp-promptname",
        },
      },
      required: ["prompt_name"],
      allOf: mcpServerConfigSchema.allOf,
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public override inputSchema(): DataPortSchema {
    return this.config?.inputSchema ?? fallbackInputSchema;
  }

  public override outputSchema(): DataPortSchema {
    return this.config?.outputSchema ?? fallbackOutputSchema;
  }

  private _schemasDiscovering = false;

  async discoverSchemas(_signal?: AbortSignal, serverConfig?: McpServerConfig): Promise<void> {
    if (this.config.inputSchema) return;
    if (this._schemasDiscovering) return;
    const transport = serverConfig?.transport ?? this.config.transport;
    if (!transport || !this.config.prompt_name) return;

    this._schemasDiscovering = true;
    try {
      const result = await mcpList({
        transport,
        server_url: serverConfig?.server_url ?? this.config.server_url,
        command: serverConfig?.command ?? this.config.command,
        args: serverConfig?.args ?? this.config.args,
        env: serverConfig?.env ?? this.config.env,
        list_type: "prompts",
      } as McpListTaskInput);

      const prompt = result.prompts?.find((p) => p.name === this.config.prompt_name);
      if (prompt) {
        const args = prompt.arguments ?? [];
        const required = args.filter((a) => a.required).map((a) => a.name);
        const properties: Record<string, { type: string; description?: string }> = {};
        for (const arg of args) {
          properties[arg.name] = {
            type: "string",
            ...(arg.description ? { description: arg.description } : {}),
          };
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.config as any).inputSchema = {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
          additionalProperties: false,
        };

        this.emitSchemaChange();
      }
    } finally {
      this._schemasDiscovering = false;
    }
  }

  async execute(
    input: McpPromptGetTaskInput,
    context: IExecuteContext
  ): Promise<McpPromptGetTaskOutput> {
    const serverConfig = getMcpServerConfig(
      this.config as Record<string, unknown>,
      context.resolvedConfig
    );

    await this.discoverSchemas(context.signal, serverConfig);

    const { mcpClientFactory } = getMcpTaskDeps();
    const { client } = await mcpClientFactory.create(serverConfig, context.signal);
    try {
      const result = await client.getPrompt({
        name: String(this.config.prompt_name ?? ""),
        arguments: input as Record<string, string>,
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
  config: McpPromptGetTaskConfig
): Promise<McpPromptGetTaskOutput> => {
  return new McpPromptGetTask({}, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    mcpPromptGet: CreateWorkflow<
      McpPromptGetTaskInput,
      McpPromptGetTaskOutput,
      McpPromptGetTaskConfig
    >;
  }
}

Workflow.prototype.mcpPromptGet = CreateWorkflow(McpPromptGetTask);
