/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject, FromSchema } from "@workglow/util/schema";
import { mcpAuthConfigSchema } from "../util/McpAuthTypes";

export const McpServerRecordSchema = {
  type: "object",
  properties: {
    server_id: { type: "string" },
    label: { type: "string" },
    description: { type: "string" },
    transport: { type: "string", enum: ["stdio", "sse", "streamable-http"] },
    server_url: { type: "string" },
    command: { type: "string" },
    args: { type: "array", items: { type: "string" } },
    env: { type: "object", additionalProperties: { type: "string" } },
    ...mcpAuthConfigSchema.properties,
  },
  required: ["server_id", "transport"],
  allOf: [
    {
      if: {
        properties: {
          transport: { const: "stdio" },
        },
      },
      then: {
        required: ["command"],
      },
    },
    {
      if: {
        properties: {
          transport: { enum: ["sse", "streamable-http"] },
        },
      },
      then: {
        required: ["server_url"],
      },
    },
  ] as readonly Record<string, unknown>[],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type McpServerRecord = FromSchema<typeof McpServerRecordSchema>;
export const McpServerPrimaryKeyNames = ["server_id"] as const;
