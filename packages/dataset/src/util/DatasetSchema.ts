/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JsonSchema } from "@workglow/util";

/**
 * Semantic format types for dataset schema annotations.
 * These are used by the InputResolver to determine how to resolve string IDs.
 */
export type DatasetSemantic = "dataset:tabular" | "dataset:document-chunk" | "dataset:document";

/**
 * Creates a JSON schema for a tabular dataset input.
 * The schema accepts either a string ID (resolved from registry) or a direct dataset instance.
 *
 * @param options Additional schema options to merge
 * @returns JSON schema for tabular dataset input
 *
 * @example
 * ```typescript
 * const inputSchema = {
 *   type: "object",
 *   properties: {
 *     dataSource: TypeTabularRepository({
 *       title: "User Database",
 *       description: "Dataset containing user records",
 *     }),
 *   },
 *   required: ["dataSource"],
 * } as const;
 * ```
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
 * Creates a JSON schema for a document chunk dataset input.
 * The schema accepts either a string ID (resolved from registry) or a direct dataset instance.
 *
 * @param options Additional schema options to merge
 * @returns JSON schema for document chunk dataset input
 */
export function TypeDocumentChunkDataset<O extends Record<string, unknown> = {}>(
  options: O = {} as O
) {
  return {
    title: "Document Chunk Dataset",
    description: "Dataset ID or instance for document chunk data storage",
    ...options,
    format: "dataset:document-chunk" as const,
    anyOf: [
      { type: "string" as const, title: "Dataset ID" },
      { title: "Dataset Instance", additionalProperties: true },
    ],
  } as const satisfies JsonSchema;
}

/**
 * Creates a JSON schema for a document dataset input.
 * The schema accepts either a string ID (resolved from registry) or a direct dataset instance.
 *
 * @param options Additional schema options to merge
 * @returns JSON schema for document dataset input
 */
export function TypeDocumentDataset<O extends Record<string, unknown> = {}>(options: O = {} as O) {
  return {
    title: "Document Dataset",
    description: "Dataset ID or instance for document data storage",
    ...options,
    format: "dataset:document" as const,
    anyOf: [
      { type: "string" as const, title: "Dataset ID" },
      { title: "Dataset Instance", additionalProperties: true },
    ],
  } as const satisfies JsonSchema;
}
