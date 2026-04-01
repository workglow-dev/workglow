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
import { DataPortSchema } from "@workglow/util/schema";
import { mcpList, type McpListTaskInput } from "./McpListTask";
import { getMcpServerConfig } from "../../mcp-server/getMcpServerConfig";
import { TypeMcpServer } from "../../mcp-server/mcpServerReferenceObjectSchema";

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

/** Config includes MCP connection fields (transport-dependent shape is registered per platform). */
export type McpToolCallTaskConfig = TaskConfig & {
  inputSchema?: DataPortSchema;
  outputSchema?: DataPortSchema;
} & Record<string, unknown>;
export type McpToolCallTaskInput = Record<string, unknown>;
export type McpToolCallTaskOutput = Record<string, unknown>;

export class McpToolCallTask extends Task<
  McpToolCallTaskInput,
  McpToolCallTaskOutput,
  McpToolCallTaskConfig
> {
  public static override type = "McpToolCallTask";
  public static override category = "MCP";
  public static override title = "MCP Call Tool";
  public static override description = "Calls a tool on an MCP server and returns the result";
  public static override cacheable = false;
  public static override customizable = true;
  public static override hasDynamicSchemas = true;

  public static override inputSchema() {
    return fallbackInputSchema;
  }

  public static override outputSchema() {
    return fallbackOutputSchema;
  }

  public static override configSchema(): DataPortSchema {
    const { mcpServerConfigSchema } = getMcpTaskDeps();
    return {
      type: "object",
      properties: {
        ...TaskConfigSchema["properties"],
        server: TypeMcpServer(mcpServerConfigSchema),
        tool_name: {
          type: "string",
          title: "Tool Name",
          description: "The name of the tool to call",
          format: "string:mcp-toolname",
        },
      },
      required: ["server", "tool_name"],
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
    if (this.config.inputSchema && this.config.outputSchema) return;
    if (this._schemasDiscovering) return;
    const resolved = serverConfig ?? getMcpServerConfig(this.config as Record<string, unknown>);
    if (!resolved.transport || !this.config.tool_name) return;

    this._schemasDiscovering = true;
    try {
      const result = await mcpList({
        server: resolved,
        list_type: "tools",
      } as McpListTaskInput);

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

  override async execute(
    input: McpToolCallTaskInput,
    context: IExecuteContext
  ): Promise<McpToolCallTaskOutput> {
    const serverConfig = getMcpServerConfig(this.config as Record<string, unknown>);

    await this.discoverSchemas(context.signal, serverConfig);

    const { mcpClientFactory } = getMcpTaskDeps();
    const { client } = await mcpClientFactory.create(serverConfig, context.signal);
    try {
      const result = await client.callTool({
        name: String(this.config.tool_name ?? ""),
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
