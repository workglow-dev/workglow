/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from "fs/promises";
import type { DataPortSchemaObject, DataPortSchemaNonBoolean } from "@workglow/util";
import { readStdin } from "../util";

function parseJson(source: string, label: string): unknown {
  try {
    return JSON.parse(source);
  } catch (e) {
    const msg = e instanceof SyntaxError ? e.message : String(e);
    console.error(`Invalid JSON (${label}): ${msg}`);
    process.exit(1);
  }
}

export interface ResolveInputOptions {
  readonly inputJson?: string;
  readonly inputJsonFile?: string;
  readonly dynamicFlags: Record<string, unknown>;
  readonly schema: DataPortSchemaObject;
}

/**
 * Merge input from multiple sources with priority:
 * 1. --input-json or --input-json-file as base
 * 2. Non-TTY stdin (if no explicit input provided)
 * 3. Dynamic flags overlay on top
 */
export async function resolveInput(opts: ResolveInputOptions): Promise<Record<string, unknown>> {
  let base: Record<string, unknown> = {};

  if (opts.inputJson) {
    base = parseJson(opts.inputJson, "--input-json") as Record<string, unknown>;
  } else if (opts.inputJsonFile) {
    const content = await readFile(opts.inputJsonFile, "utf-8");
    base = parseJson(content, opts.inputJsonFile) as Record<string, unknown>;
  } else if (!process.stdin.isTTY) {
    const stdinContent = await readStdin();
    if (stdinContent) {
      base = parseJson(stdinContent, "stdin") as Record<string, unknown>;
    }
  }

  // Dynamic flags overlay on top of base
  return deepMerge(base, opts.dynamicFlags);
}

export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Read JSON input from --input-json, --input-json-file, or non-TTY stdin.
 * Used for commands where dynamic flags don't apply (workflow/agent add).
 */
export async function readJsonInput(opts: {
  inputJson?: string;
  inputJsonFile?: string;
}): Promise<unknown> {
  if (opts.inputJson) {
    return parseJson(opts.inputJson, "--input-json");
  }
  if (opts.inputJsonFile) {
    const content = await readFile(opts.inputJsonFile, "utf-8");
    return parseJson(content, opts.inputJsonFile);
  }
  if (!process.stdin.isTTY) {
    const stdinContent = await readStdin();
    if (stdinContent) {
      return parseJson(stdinContent, "stdin");
    }
  }
  throw new Error(
    "No input provided. Use --input-json, --input-json-file, or pipe JSON to stdin."
  );
}

/**
 * Read task/workflow config from --config-json or --config-json-file.
 * Returns an empty object if neither is provided.
 */
export async function resolveConfig(opts: {
  configJson?: string;
  configJsonFile?: string;
}): Promise<Record<string, unknown>> {
  if (opts.configJson) {
    return parseJson(opts.configJson, "--config-json") as Record<string, unknown>;
  }
  if (opts.configJsonFile) {
    const content = await readFile(opts.configJsonFile, "utf-8");
    return parseJson(content, opts.configJsonFile) as Record<string, unknown>;
  }
  return {};
}

/**
 * Apply default values from schema for missing fields.
 */
export function applySchemaDefaults(
  input: Record<string, unknown>,
  schema: DataPortSchemaObject
): Record<string, unknown> {
  const result = { ...input };
  const properties = schema.properties ?? {};
  for (const [key, prop] of Object.entries(properties)) {
    if (typeof prop === "boolean" || !prop) continue;
    if (!(key in result) && "default" in prop) {
      result[key] = prop.default;
    }
  }
  return result;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: string[];
}

/**
 * Validate input against a DataPortSchemaObject.
 * Checks required properties and basic type matching.
 */
export function validateInput(
  input: Record<string, unknown>,
  schema: DataPortSchemaObject
): ValidationResult {
  const errors: string[] = [];
  const properties = schema.properties ?? {};
  const required = (schema.required as readonly string[] | undefined) ?? [];

  // Check required properties
  for (const name of required) {
    if (!(name in input) || input[name] === undefined) {
      const prop = properties[name];
      // Skip if the property has a default value
      if (prop && typeof prop === "object" && "default" in prop) continue;
      errors.push(`Missing required property: ${name}`);
    }
  }

  // Check types for provided properties
  for (const [key, value] of Object.entries(input)) {
    const prop = properties[key] as DataPortSchemaNonBoolean | undefined;
    if (!prop || typeof prop === "boolean") continue;

    const expectedType = prop.type;
    if (!expectedType || value === undefined || value === null) continue;

    const actualType = Array.isArray(value) ? "array" : typeof value;

    if (expectedType === "integer" || expectedType === "number") {
      if (typeof value !== "number") {
        errors.push(`Property "${key}" expected ${expectedType}, got ${actualType}`);
      }
    } else if (expectedType === "array") {
      if (!Array.isArray(value)) {
        errors.push(`Property "${key}" expected array, got ${actualType}`);
      }
    } else if (actualType !== expectedType) {
      errors.push(`Property "${key}" expected ${expectedType}, got ${actualType}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
