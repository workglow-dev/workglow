/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util/schema";

/**
 * Bounds on a JSON Schema that a language model wrote.
 *
 * A schema a model authored is model-controlled input, and the sibling guard
 * for the other half of that surface sits beside it: tool-call *arguments* go
 * through {@link sanitizeToolArgs} before validation. Arguments are bounded by
 * the schema; the schema itself is bounded by nothing, and it drives a
 * renderer.
 */
export interface ModelAuthoredSchemaLimits {
  /** Maximum properties on any one object. */
  readonly maxProperties: number;
  /** Maximum nesting depth below the root. */
  readonly maxDepth: number;
  /**
   * `format` values a model may ask for.
   *
   * This is the load-bearing one, and it is an allowlist for the same reason
   * the entitlement gate is: in this codebase a `format` annotation does not
   * merely style a field, it selects a runtime editor and resolves a live
   * resource — `"storage:tabular"`, `"knowledge-base"`, `"credential"`. An
   * unbounded `format` is therefore the model choosing a resource, and a
   * denylist would hand every format added later to whoever asks for it first.
   */
  readonly allowedFormats: ReadonlySet<string>;
  /**
   * Prefixes a `format` may carry, for families whose tail is a free
   * parameter — `"model:EmbeddingTask"` names a task, not a resource to open.
   */
  readonly allowedFormatPrefixes: readonly string[];
}

/**
 * Formats safe to hand a model-authored form: presentation and picker hints
 * that resolve nothing on their own. Anything naming a stored resource is
 * absent, and absent means refused.
 */
export const DEFAULT_MODEL_AUTHORED_SCHEMA_LIMITS: ModelAuthoredSchemaLimits = Object.freeze({
  maxProperties: 20,
  maxDepth: 3,
  allowedFormats: new Set([
    "date",
    "date-time",
    "time",
    "uri",
    "email",
    "textarea",
    "color",
    "model",
  ]),
  allowedFormatPrefixes: ["model:"],
});

export type ModelAuthoredSchemaResult =
  | { readonly ok: true; readonly schema: DataPortSchemaObject }
  | { readonly ok: false; readonly reason: string };

function formatAllowed(format: string, limits: ModelAuthoredSchemaLimits): boolean {
  if (limits.allowedFormats.has(format)) return true;
  return limits.allowedFormatPrefixes.some((prefix) => format.startsWith(prefix));
}

function check(
  node: unknown,
  path: string,
  depth: number,
  limits: ModelAuthoredSchemaLimits
): string | undefined {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return `${path || "schema"} must be an object schema`;
  }
  const schema = node as Record<string, unknown>;
  if (depth > limits.maxDepth) return `nesting depth at ${path} exceeds ${limits.maxDepth}`;
  if (typeof schema.format === "string" && !formatAllowed(schema.format, limits)) {
    return `format "${schema.format}" at ${path || "root"} is not allowed in a model-authored schema`;
  }
  if (schema.type === "object" || schema.properties) {
    const properties = schema.properties;
    if (properties !== undefined) {
      if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
        return `properties at ${path || "root"} must be an object`;
      }
      const keys = Object.keys(properties as Record<string, unknown>);
      if (keys.length > limits.maxProperties) {
        return `too many properties at ${path || "root"} (max ${limits.maxProperties})`;
      }
      for (const key of keys) {
        const error = check(
          (properties as Record<string, unknown>)[key],
          path ? `${path}.${key}` : key,
          depth + 1,
          limits
        );
        if (error) return error;
      }
    }
  }
  if (schema.items !== undefined) {
    const error = check(schema.items, `${path}[]`, depth + 1, limits);
    if (error) return error;
  }
  return undefined;
}

/**
 * Validates a model-authored JSON Schema before it reaches a form renderer.
 *
 * Returns the reason rather than throwing, because the caller's next move is
 * usually to hand that reason back to the model so it can fix the schema —
 * a rejection it can act on beats an exception it cannot see.
 */
export function validateModelAuthoredSchema(
  schema: unknown,
  limits: ModelAuthoredSchemaLimits = DEFAULT_MODEL_AUTHORED_SCHEMA_LIMITS
): ModelAuthoredSchemaResult {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { ok: false, reason: "schema must be a JSON Schema object" };
  }
  const root = schema as Record<string, unknown>;
  if (root.type !== "object" || !root.properties) {
    return { ok: false, reason: 'schema root must have type "object" and "properties"' };
  }
  const error = check(schema, "", 0, limits);
  if (error) return { ok: false, reason: error };
  return { ok: true, schema: schema as DataPortSchemaObject };
}
