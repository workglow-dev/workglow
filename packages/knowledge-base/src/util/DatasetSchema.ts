/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JsonSchema } from "@workglow/util";

/**
 * Creates a JSON schema for a tabular dataset input.
 * The schema accepts either a string ID (resolved from registry) or a direct dataset instance.
 */
export function TypeTabularStorage<O extends Record<string, unknown> = {}>(options: O = {} as O) {
  return {
    title: "Tabular Storage",
    description: "Storage ID or instance for tabular data storage",
    ...options,
    format: "storage:tabular" as const,
    oneOf: [
      { type: "string" as const, title: "Storage ID" },
      { title: "Storage Instance", additionalProperties: true },
    ],
  } as const satisfies JsonSchema;
}

/**
 * Creates a JSON schema for a knowledge base input.
 * The schema accepts either a string ID (resolved from registry) or a direct KnowledgeBase instance.
 */
export function TypeKnowledgeBase<O extends Record<string, unknown> = {}>(options: O = {} as O) {
  return {
    title: "Knowledge Base",
    description: "Knowledge base ID or instance",
    ...options,
    format: "knowledge-base" as const,
    anyOf: [
      { type: "string" as const, title: "Knowledge Base ID" },
      { title: "Knowledge Base Instance", additionalProperties: true },
    ],
  } as const satisfies JsonSchema;
}
