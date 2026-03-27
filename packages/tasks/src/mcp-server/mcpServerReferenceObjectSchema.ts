/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * JSON Schema properties for the object branch of task `server` oneOf (string ID | object).
 * Includes optional registry metadata so resolved {@link McpServerRecord} values validate.
 */

import type { DataPortSchemaObject } from "@workglow/util/schema";
import { mcpServerConfigSchema } from "../util/McpClientUtil";

/** Optional fields from {@link McpServerRecordSchema} not present on {@link mcpServerConfigSchema}. */
const mcpServerRecordMetadataProperties = {
  server_id: {
    type: "string",
    title: "Server ID",
    description:
      "MCP server repository id; present when the server reference was resolved from the registry",
  },
  label: {
    type: "string",
    title: "Label",
    description: "Display label for the server (optional)",
  },
  description: {
    type: "string",
    title: "Description",
    description: "Optional human-readable description",
  },
} as const satisfies DataPortSchemaObject["properties"];

/**
 * Properties allowed on the inline/resolved `server` object in MCP task config or input.
 * Superset of connection fields plus optional repository metadata.
 */
export const mcpServerReferenceObjectProperties = {
  ...mcpServerConfigSchema.properties,
  ...mcpServerRecordMetadataProperties,
} as const satisfies DataPortSchemaObject["properties"];
