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
import {
  DataPortSchema,
  FromSchema,
  mcpClientFactory,
  mcpServerConfigSchema,
  type McpServerConfig,
} from "@workglow/util";
import { mcpList } from "./McpListTask";

const configSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    server: {
      type: "string",
      format: "mcp-server",
      title: "MCP Server",
      description: "Server ID from the MCP server registry (alternative to inline config)",
    },
    ...mcpServerConfigSchema.properties,
    tool_name: {
      type: "string",
      title: "Tool Name",
      description: "The name of the tool to call",
      format: "string:mcp-toolname",
    },
  },
  required: ["tool_name"],
  anyOf: [
    { required: ["server"] },
    { required: ["transport", "command"], properties: { transport: { const: "stdio" } } },
    {
      required: ["transport", "server_url"],
      properties: { transport: { enum: ["sse", "streamable-http"] } },
    },
  ],
  allOf: mcpServerConfigSchema.allOf,
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

const fallbackOutputSchema = {
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

const fallbackInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as const satisfies DataPortSchema;

/** Base config from schema; inputSchema/outputSchema overridden to DataPortSchema so constructor accepts TaskConfig from registry. */
type McpToolCallConfigFromSchema = Omit<
  FromSchema<typeof configSchema>,
  "inputSchema" | "outputSchema"
>;
export type McpToolCallTaskConfig = TaskConfig &
  McpToolCallConfigFromSchema & {
    inputSchema?: DataPortSchema;
    outputSchema?: DataPortSchema;
  };
export type McpToolCallTaskInput = Record<string, unknown>;
export type McpToolCallTaskOutput = Record<string, unknown>;

export class McpToolCallTask extends Task<
  McpToolCallTaskInput,
  McpToolCallTaskOutput,
  McpToolCallTaskConfig
> {
  public static type = "McpToolCallTask";
  public static category = "MCP";
  public static title = "MCP Call Tool";
  public static description = "Calls a tool on an MCP server and returns the result";
  public static cacheable = false;
  public static customizable = true;
  public static hasDynamicSchemas = true;

  public static inputSchema() {
    return fallbackInputSchema;
  }

  public static outputSchema() {
    return fallbackOutputSchema;
  }

  public static configSchema() {
    return configSchema;
  }

  public override inputSchema(): DataPortSchema {
    return this.config?.inputSchema ?? fallbackInputSchema;
  }

  public override outputSchema(): DataPortSchema {
    return this.config?.outputSchema ?? fallbackOutputSchema;
  }

  private _schemasDiscovering = false;

  private getMcpServerConfig(): McpServerConfig | undefined {
    const server = this.config.server as Record<string, unknown> | string | undefined;
    const base = typeof server === "object" && server !== null ? server : {};
    const merged = { ...base } as Record<string, unknown>;
    // Inline fields override registry values
    for (const key of ["transport", "server_url", "command", "args", "env"] as const) {
      if (this.config[key] !== undefined) {
        merged[key] = this.config[key];
      }
    }
    if (!merged.transport) return undefined;
    return merged as unknown as McpServerConfig;
  }

  async discoverSchemas(signal?: AbortSignal): Promise<void> {
    if (this.config.inputSchema && this.config.outputSchema) return;
    if (this._schemasDiscovering) return;
    if (!this.config.tool_name) return;

    const serverConfig = this.getMcpServerConfig();
    if (!serverConfig) return;

    this._schemasDiscovering = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cfg = serverConfig as any;
      const result = await mcpList({
        transport: cfg.transport,
        server_url: cfg.server_url,
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
        list_type: "tools",
      });

      const tool = result.tools?.find((t) => t.name === this.config.tool_name);
      if (tool) {
        if (!this.config.inputSchema) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this.config as any).inputSchema = tool.inputSchema;
        }
        if (!this.config.outputSchema && tool.outputSchema) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this.config as any).outputSchema = tool.outputSchema;
        }
        this.emitSchemaChange();
      }
    } finally {
      this._schemasDiscovering = false;
    }
  }

  async execute(
    input: McpToolCallTaskInput,
    context: IExecuteContext
  ): Promise<McpToolCallTaskOutput> {
    await this.discoverSchemas(context.signal);

    const serverConfig = this.getMcpServerConfig();
    if (!serverConfig) {
      throw new Error("MCP server transport is required (provide inline or via server registry)");
    }
    const { client } = await mcpClientFactory.create(serverConfig, context.signal);
    try {
      const result = await client.callTool({
        name: this.config.tool_name,
        arguments: input as Record<string, unknown>,
      });
      if (!("content" in result) || !Array.isArray(result.content)) {
        throw new Error("Expected tool result with content array");
      }
      const content = result.content;
      const isError = result.isError === true;

      // Prefer structuredContent when present (MCP spec: parsed output matching tool's output schema)
      const structuredContent =
        "structuredContent" in result &&
        result.structuredContent &&
        typeof result.structuredContent === "object" &&
        !Array.isArray(result.structuredContent)
          ? (result.structuredContent as Record<string, unknown>)
          : undefined;

      // When no structuredContent, try parsing single text item as JSON (many servers return JSON in text)
      let parsedFromText: Record<string, unknown> | undefined;
      if (!structuredContent && content.length === 1) {
        const item = content[0];
        if (
          item &&
          typeof item === "object" &&
          "type" in item &&
          item.type === "text" &&
          "text" in item
        ) {
          const text = String(item.text);
          const trimmed = text.trim();
          if (
            (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
            (trimmed.startsWith("[") && trimmed.endsWith("]"))
          ) {
            try {
              const parsed = JSON.parse(text) as unknown;
              if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
                parsedFromText = parsed as Record<string, unknown>;
              }
            } catch {
              // Not valid JSON, ignore
            }
          }
        }
      }

      return {
        content,
        isError,
        ...parsedFromText,
        ...structuredContent,
      };
    } finally {
      await client.close();
    }
  }
}

export const mcpToolCall = async (
  input: McpToolCallTaskInput,
  config: McpToolCallTaskConfig
): Promise<McpToolCallTaskOutput> => {
  return new McpToolCallTask({}, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    mcpToolCall: CreateWorkflow<McpToolCallTaskInput, McpToolCallTaskOutput, McpToolCallTaskConfig>;
  }
}

Workflow.prototype.mcpToolCall = CreateWorkflow(McpToolCallTask);
