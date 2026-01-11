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
 * Gets the format prefix from a format string.
 * For "model:TextEmbedding" returns "model"
 * For "repository:tabular" returns "repository"
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
    const value = resolved[key];

    const format = getSchemaFormat(propSchema);
    if (!format) continue;

    // Try full format first (e.g., "repository:document-chunk-vector"), then fall back to prefix (e.g., "repository")
    let resolver = resolvers.get(format);
    if (!resolver) {
      const prefix = getFormatPrefix(format);
      resolver = resolvers.get(prefix);
    }

    if (!resolver) continue;

    // Handle string values
    if (typeof value === "string") {
      resolved[key] = await resolver(value, format, config.registry);
    }
    // Handle arrays of strings - pass the entire array to the resolver
    // (resolvers like resolveModelFromRegistry handle arrays even though typed as string)
    else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      resolved[key] = await resolver(value as unknown as string, format, config.registry);
    }
    // Skip if not a string or array of strings (already resolved or direct instance)
  }

  return resolved as T;
}
