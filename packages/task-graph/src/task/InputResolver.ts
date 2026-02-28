/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema, ServiceRegistry } from "@workglow/util";
import { getInputResolvers } from "@workglow/util";

/**
 * Configuration for the input resolver
 */
export interface InputResolverConfig {
  readonly registry: ServiceRegistry;
}

/**
 * Extracts the format string from a schema, handling oneOf/anyOf wrappers.
 */
function getSchemaFormat(schema: unknown): string | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;

  const s = schema as Record<string, unknown>;

  // Direct format
  if (typeof s.format === "string") return s.format;

  // Check oneOf/anyOf for format
  const variants = (s.oneOf ?? s.anyOf) as unknown[] | undefined;
  if (Array.isArray(variants)) {
    for (const variant of variants) {
      if (typeof variant === "object" && variant !== null) {
        const v = variant as Record<string, unknown>;
        if (typeof v.format === "string") return v.format;
      }
    }
  }

  return undefined;
}

/**
 * Extracts the object-typed schema from a property schema, handling oneOf/anyOf wrappers.
 * This is needed for patterns like `oneOf: [{ type: "string" }, { type: "object", properties: {...} }]`
 * where the model can be either a string ID or an inline config object.
 */
function getObjectSchema(
  schema: unknown
): (Record<string, unknown> & { properties: Record<string, unknown> }) | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;

  const s = schema as Record<string, unknown>;

  // Direct object schema with properties
  if (s.type === "object" && s.properties && typeof s.properties === "object") {
    return s as Record<string, unknown> & { properties: Record<string, unknown> };
  }

  // Check oneOf/anyOf for object variant
  const variants = (s.oneOf ?? s.anyOf) as unknown[] | undefined;
  if (Array.isArray(variants)) {
    for (const variant of variants) {
      if (typeof variant === "object" && variant !== null) {
        const v = variant as Record<string, unknown>;
        if (v.type === "object" && v.properties && typeof v.properties === "object") {
          return v as Record<string, unknown> & { properties: Record<string, unknown> };
        }
      }
    }
  }

  return undefined;
}

/**
 * Gets the format prefix from a format string.
 * For "model:TextEmbedding" returns "model"
 * For "storage:tabular" returns "storage"
 */
function getFormatPrefix(format: string): string {
  const colonIndex = format.indexOf(":");
  return colonIndex >= 0 ? format.substring(0, colonIndex) : format;
}

/**
 * Resolves schema-annotated inputs by looking up string IDs from registries.
 * String values with matching format annotations are resolved to their instances.
 * Non-string values (objects/instances) are passed through unchanged.
 *
 * @param input The task input object
 * @param schema The task's input schema
 * @param config Configuration including the service registry
 * @returns The input with resolved values
 *
 * @example
 * ```typescript
 * // In TaskRunner.run()
 * const resolvedInput = await resolveSchemaInputs(
 *   this.task.runInputData,
 *   (this.task.constructor as typeof Task).inputSchema(),
 *   { registry: this.registry }
 * );
 * ```
 */
export async function resolveSchemaInputs<T extends Record<string, unknown>>(
  input: T,
  schema: DataPortSchema,
  config: InputResolverConfig
): Promise<T> {
  if (typeof schema === "boolean") return input;

  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return input;

  const resolvers = getInputResolvers();
  const resolved: Record<string, unknown> = { ...input };

  for (const [key, propSchema] of Object.entries(properties)) {
    let value = resolved[key];

    // Phase 1: Resolve format-annotated string values
    const format = getSchemaFormat(propSchema);
    if (format) {
      // Try full format first (e.g., "dataset:document-chunk"), then fall back to prefix (e.g., "dataset")
      let resolver = resolvers.get(format);
      if (!resolver) {
        const prefix = getFormatPrefix(format);
        resolver = resolvers.get(prefix);
      }

      if (resolver) {
        // Handle string values
        if (typeof value === "string") {
          value = await resolver(value, format, config.registry);
          resolved[key] = value;
        }
        // Handle arrays of strings - iterate and resolve each element
        else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
          const results = await Promise.all(
            (value as string[]).map((item) => resolver(item, format, config.registry))
          );
          value = results.filter((result) => result !== undefined);
          resolved[key] = value;
        }
      }
    }

    // Phase 2: Recurse into object values if the schema defines nested properties
    if (value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)) {
      const objectSchema = getObjectSchema(propSchema);
      if (objectSchema) {
        resolved[key] = await resolveSchemaInputs(
          value as Record<string, unknown>,
          objectSchema as DataPortSchema,
          config
        );
      }
    }
  }

  return resolved as T;
}
