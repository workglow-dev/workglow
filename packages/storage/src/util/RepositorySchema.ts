/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JsonSchema } from "@workglow/util";

/**
 * Semantic format types for repository schema annotations.
 * These are used by the InputResolver to determine how to resolve string IDs.
 */
export type RepositorySemantic =
  | "repository:tabular"
  | "repository:document-chunk-vector"
  | "repository:document";

/**
 * Creates a JSON schema for a tabular repository input.
 * The schema accepts either a string ID (resolved from registry) or a direct repository instance.
 *
 * @param options Additional schema options to merge
 * @returns JSON schema for tabular repository input
 *
 * @example
 * ```typescript
 * const inputSchema = {
 *   type: "object",
 *   properties: {
 *     dataSource: TypeTabularRepository({
 *       title: "User Database",
 *       description: "Repository containing user records",
 *     }),
 *   },
 *   required: ["dataSource"],
 * } as const;
 * ```
 */
export function TypeTabularRepository<O extends Record<string, unknown> = {}>(
  options: O = {} as O
) {
  return {
    title: "Tabular Repository",
    description: "Repository ID or instance for tabular data storage",
    ...options,
    format: "repository:tabular" as const,
    oneOf: [
      { type: "string" as const, title: "Repository ID" },
      { title: "Repository Instance", additionalProperties: true },
    ],
  } as const satisfies JsonSchema;
}

/**
 * Creates a JSON schema for a vector repository input.
 * The schema accepts either a string ID (resolved from registry) or a direct repository instance.
 *
 * @param options Additional schema options to merge
 * @returns JSON schema for vector repository input
 */
export function TypeDocumentChunkVectorRepository<O extends Record<string, unknown> = {}>(
  options: O = {} as O
) {
  return {
    title: "Document Chunk Vector Repository",
    description: "Repository ID or instance for document chunk vector data storage",
    ...options,
    format: "repository:document-chunk-vector" as const,
    anyOf: [
      { type: "string" as const, title: "Repository ID" },
      { title: "Repository Instance", additionalProperties: true },
    ],
  } as const satisfies JsonSchema;
}

/**
 * Creates a JSON schema for a document repository input.
 * The schema accepts either a string ID (resolved from registry) or a direct repository instance.
 *
 * @param options Additional schema options to merge
 * @returns JSON schema for document repository input
 */
export function TypeDocumentRepository<O extends Record<string, unknown> = {}>(
  options: O = {} as O
) {
  return {
    title: "Document Repository",
    description: "Repository ID or instance for document data storage",
    ...options,
    format: "repository:document" as const,
    anyOf: [
      { type: "string" as const, title: "Repository ID" },
      { title: "Repository Instance", additionalProperties: true },
    ],
  } as const satisfies JsonSchema;
}
