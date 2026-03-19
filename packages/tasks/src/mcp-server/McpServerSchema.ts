/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DataPortSchemaObject, FromSchema, mcpServerConfigSchema } from "@workglow/util";

/**
 * A lightweight MCP server configuration suitable for task config/input schemas.
 *
 * When a task property is annotated with `format: "mcp-server"` and contains a
 * string value, the input resolver system resolves it to the full server record
 * from the registry. This schema defines the shape of that resolved record.
 */
export const McpServerConfigSchema = {
  type: "object",
  properties: {
    server_id: { type: "string" },
    title: { type: "string" },
    description: { type: "string", "x-ui-editor": "textarea" },
    ...mcpServerConfigSchema.properties,
    metadata: { type: "object", default: {}, "x-ui-hidden": true },
  },
  required: ["transport"],
  allOf: mcpServerConfigSchema.allOf,
  format: "mcp-server",
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

/**
 * A fully-specified MCP server record suitable for persistence in a repository.
 */
export const McpServerRecordSchema = {
  type: "object",
  properties: {
    ...McpServerConfigSchema.properties,
  },
  required: ["server_id", "title", "transport"],
  format: "mcp-server",
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type McpServerTaskConfig = FromSchema<typeof McpServerConfigSchema>;
export type McpServerRecord = FromSchema<typeof McpServerRecordSchema>;
export const McpServerPrimaryKeyNames = ["server_id"] as const;
