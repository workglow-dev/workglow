/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaNonBoolean, DataPortSchemaObject } from "@workglow/util/schema";
import { setNestedValue } from "../util";

type SchemaProperty = DataPortSchemaNonBoolean;

/**
 * Parse dynamic flags from argv based on a DataPortSchemaObject.
 * Supports `-key=value`, `-key value`, and dot notation (`-model.provider=HF`).
 */
export function parseDynamicFlags(
  argv: string[],
  schema: DataPortSchemaObject
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const properties = schema.properties ?? {};

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    // Only handle single-dash flags (not --)
    if (!arg.startsWith("-") || arg.startsWith("--") || arg === "-") {
      i++;
      continue;
    }

    const rest = arg.slice(1);
    let key: string;
    let value: string | undefined;

    const eqIndex = rest.indexOf("=");
    if (eqIndex !== -1) {
      key = rest.slice(0, eqIndex);
      value = rest.slice(eqIndex + 1);
    } else {
      key = rest;
      // Peek next arg for value (if not another flag)
      if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        value = argv[i + 1];
        i++;
      } else {
        // Boolean flag with no value
        value = "true";
      }
    }

    const coerced = coerceValue(key, value, properties);
    setNestedValue(result, key, coerced);
    i++;
  }

  return result;
}

function coerceValue(
  key: string,
  value: string,
  properties: Record<string, SchemaProperty>
): unknown {
  const parts = key.split(".");
  let schemaProp: SchemaProperty | undefined = properties[parts[0]];

  // Walk into nested object schemas for dot notation
  for (let i = 1; i < parts.length && schemaProp; i++) {
    if (typeof schemaProp === "object" && "properties" in schemaProp && schemaProp.properties) {
      schemaProp = schemaProp.properties[parts[i]] as SchemaProperty | undefined;
    } else {
      schemaProp = undefined;
    }
  }

  if (!schemaProp || typeof schemaProp === "boolean") {
    return value;
  }

  const type = schemaProp.type;

  switch (type) {
    case "number":
      return parseFloat(value);
    case "integer":
      return parseInt(value, 10);
    case "boolean":
      return value === "true" || value === "1";
    case "array":
      try {
        return JSON.parse(value);
      } catch {
        return value.split(",");
      }
    case "object":
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    default:
      return value;
  }
}

/**
 * Parse config flags from argv based on a config schema.
 *
 * Accepts two forms:
 * - `-config-key=value` (always works, explicit config prefix)
 * - `-key=value` (shorthand, only when key does NOT conflict with inputSchema properties)
 *
 * Supports dot notation for nested objects: `-config-a.b=value`.
 */
export function parseConfigFlags(
  argv: string[],
  configSchema: DataPortSchemaObject,
  inputSchema: DataPortSchemaObject
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const configProperties = configSchema.properties ?? {};
  const inputProperties = inputSchema.properties ?? {};

  // Collect all top-level input property names for conflict detection
  const inputKeys = new Set(Object.keys(inputProperties));

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (!arg.startsWith("-") || arg.startsWith("--") || arg === "-") {
      i++;
      continue;
    }

    const rest = arg.slice(1);
    let rawKey: string;
    let value: string | undefined;

    const eqIndex = rest.indexOf("=");
    if (eqIndex !== -1) {
      rawKey = rest.slice(0, eqIndex);
      value = rest.slice(eqIndex + 1);
    } else {
      rawKey = rest;
      if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        value = argv[i + 1];
        i++;
      } else {
        value = "true";
      }
    }

    // Determine if this is a config flag
    let configKey: string | undefined;
    if (rawKey.startsWith("config-")) {
      // Explicit config prefix: -config-stuff=xxx → key "stuff"
      configKey = rawKey.slice(7);
    } else {
      // Shorthand: -stuff=xxx → only if "stuff" is in configSchema but NOT in inputSchema
      const topLevel = rawKey.split(".")[0];
      if (topLevel in configProperties && !inputKeys.has(topLevel)) {
        configKey = rawKey;
      }
    }

    if (configKey !== undefined) {
      const coerced = coerceValue(configKey, value, configProperties);
      setNestedValue(result, configKey, coerced);
    }

    i++;
  }

  return result;
}

/**
 * Generate help text for config flags, showing -config-key form
 * and noting shorthand when there's no input conflict.
 */
export function generateConfigHelpText(
  configSchema: DataPortSchemaObject,
  inputSchema: DataPortSchemaObject
): string {
  const lines: string[] = [];
  const configProperties = configSchema.properties ?? {};
  const inputProperties = inputSchema.properties ?? {};
  const inputKeys = new Set(Object.keys(inputProperties));
  const required = new Set((configSchema.required as readonly string[] | undefined) ?? []);

  for (const [name, prop] of Object.entries(configProperties)) {
    if (typeof prop === "boolean") continue;

    const type = prop.type ?? "string";
    const isRequired = required.has(name);
    const description = prop.description ?? "";
    const defaultVal = "default" in prop ? ` (default: ${JSON.stringify(prop.default)})` : "";
    const enumVal = "enum" in prop && Array.isArray(prop.enum) ? ` [${prop.enum.join(", ")}]` : "";
    const reqLabel = isRequired ? " (required)" : "";
    const shorthand = !inputKeys.has(name) ? ` (or -${name})` : "";

    lines.push(
      `  -config-${name}  <${type}>${reqLabel}  ${description}${enumVal}${defaultVal}${shorthand}`
    );
  }

  if (lines.length === 0) {
    return "  (no config properties)";
  }

  return lines.join("\n");
}

/**
 * Generate help text from a DataPortSchemaObject showing available dynamic flags.
 */
export function generateSchemaHelpText(schema: DataPortSchemaObject): string {
  const lines: string[] = [];
  const properties = schema.properties ?? {};
  const required = new Set((schema.required as readonly string[] | undefined) ?? []);

  generatePropertyLines(properties, required, "", lines);

  if (lines.length === 0) {
    return "  (no input properties)";
  }

  return lines.join("\n");
}

function generatePropertyLines(
  properties: Record<string, SchemaProperty>,
  required: Set<string>,
  prefix: string,
  lines: string[]
): void {
  for (const [name, prop] of Object.entries(properties)) {
    if (typeof prop === "boolean") continue;

    const fullName = prefix ? `${prefix}.${name}` : name;
    const type = prop.type ?? "string";
    const isRequired = required.has(name);
    const description = prop.description ?? "";
    const defaultVal = "default" in prop ? ` (default: ${JSON.stringify(prop.default)})` : "";
    const enumVal = "enum" in prop && Array.isArray(prop.enum) ? ` [${prop.enum.join(", ")}]` : "";
    const reqLabel = isRequired ? " (required)" : "";

    lines.push(`  -${fullName}  <${type}>${reqLabel}  ${description}${enumVal}${defaultVal}`);

    // Recurse into nested objects
    if (type === "object" && "properties" in prop && prop.properties) {
      const nestedRequired = new Set((prop.required as readonly string[] | undefined) ?? []);
      generatePropertyLines(
        prop.properties as Record<string, SchemaProperty>,
        nestedRequired,
        fullName,
        lines
      );
    }
  }
}
