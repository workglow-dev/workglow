/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITaskGraph } from "./ITaskGraph";
import { getSchemaFormat, getObjectSchema } from "../task/InputResolver";

/**
 * Result of scanning a task graph for credential format annotations.
 */
export interface GraphFormatScanResult {
  /** Whether any task in the graph has a `format: "credential"` property in its input or config schema. */
  readonly needsCredentials: boolean;
  /** The set of format strings found (e.g., `"credential"`). */
  readonly credentialFormats: ReadonlySet<string>;
}

/**
 * Recursively walks a JSON Schema's properties looking for any property whose
 * format annotation matches `targetFormat`. Handles nested objects and
 * `oneOf`/`anyOf` wrappers.
 */
function schemaHasFormat(schema: unknown, targetFormat: string): boolean {
  if (typeof schema !== "object" || schema === null) return false;
  const s = schema as Record<string, unknown>;

  const properties = s.properties as Record<string, unknown> | undefined;
  if (properties && typeof properties === "object") {
    for (const propSchema of Object.values(properties)) {
      const format = getSchemaFormat(propSchema);
      if (format === targetFormat) return true;

      // Recurse into nested object schemas
      const objectSchema = getObjectSchema(propSchema);
      if (objectSchema && schemaHasFormat(objectSchema, targetFormat)) return true;
    }
  }

  return false;
}

/**
 * Scans a task graph for any task whose input or config schema contains a
 * property with the given format annotation.
 *
 * @param graph The task graph to scan
 * @param targetFormat The format string to search for (e.g., `"credential"`)
 * @returns `true` if at least one task has a matching format annotation
 */
export function scanGraphForFormat(graph: ITaskGraph, targetFormat: string): boolean {
  for (const task of graph.getTasks()) {
    const inputSchema = task.inputSchema();
    if (typeof inputSchema !== "boolean" && schemaHasFormat(inputSchema, targetFormat)) {
      return true;
    }

    const configSchema = task.configSchema();
    if (typeof configSchema !== "boolean" && schemaHasFormat(configSchema, targetFormat)) {
      return true;
    }
  }
  return false;
}

/**
 * Scans a task graph for credential requirements.
 *
 * Walks every task's `inputSchema()` and `configSchema()` looking for properties
 * annotated with `format: "credential"`, including nested objects like
 * `provider_config.credential_key`.
 *
 * @example
 * ```ts
 * const result = scanGraphForCredentials(graph);
 * if (result.needsCredentials) {
 *   await ensureCredentialStoreUnlocked();
 * }
 * ```
 */
export function scanGraphForCredentials(graph: ITaskGraph): GraphFormatScanResult {
  const credentialFormats = new Set<string>();

  for (const task of graph.getTasks()) {
    collectCredentialFormats(task.inputSchema(), credentialFormats);
    collectCredentialFormats(task.configSchema(), credentialFormats);
  }

  return {
    needsCredentials: credentialFormats.size > 0,
    credentialFormats,
  };
}

/**
 * Collects all "credential" format annotations from a schema into the provided set.
 */
function collectCredentialFormats(schema: unknown, formats: Set<string>): void {
  if (typeof schema === "boolean" || typeof schema !== "object" || schema === null) return;
  const s = schema as Record<string, unknown>;

  const properties = s.properties as Record<string, unknown> | undefined;
  if (!properties || typeof properties !== "object") return;

  for (const propSchema of Object.values(properties)) {
    const format = getSchemaFormat(propSchema);
    if (format === "credential") {
      formats.add(format);
    }

    // Recurse into nested object schemas
    const objectSchema = getObjectSchema(propSchema);
    if (objectSchema) {
      collectCredentialFormats(objectSchema, formats);
    }
  }
}
