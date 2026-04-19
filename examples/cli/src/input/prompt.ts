/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaNonBoolean, DataPortSchemaObject } from "@workglow/util/schema";
import { loadConfig } from "../config";
import { createModelRepository } from "../storage";
import { renderSchemaPrompt } from "../ui/render";
import { getNestedValue } from "../util";
import { deepMerge } from "./resolve-input";
import { evaluateConditionalRequired } from "./schema-conditions";

export interface PromptFieldDescriptor {
  readonly key: string;
  readonly type: "string" | "number" | "integer" | "boolean" | "enum" | "array" | "object";
  readonly label: string;
  readonly description?: string;
  readonly format?: string;
  readonly enumValues?: readonly string[];
  readonly defaultValue?: unknown;
  readonly required: boolean;
}

type SchemaProperty = DataPortSchemaNonBoolean;

/**
 * Walk schema properties and return descriptors for missing required fields.
 * Evaluates allOf if/then conditions to include conditionally required fields.
 */
export function getMissingFields(
  input: Record<string, unknown>,
  schema: DataPortSchemaObject
): PromptFieldDescriptor[] {
  const fields: PromptFieldDescriptor[] = [];
  const properties = schema.properties ?? {};
  const required = new Set((schema.required as readonly string[] | undefined) ?? []);

  // Evaluate allOf if/then conditions to find conditionally required fields
  const conditionalRequired = evaluateConditionalRequired(input, schema);
  for (const name of conditionalRequired) {
    required.add(name);
  }

  collectMissingFields(properties, required, input, "", fields);
  return fields;
}

function collectMissingFields(
  properties: Record<string, SchemaProperty>,
  required: Set<string>,
  input: Record<string, unknown>,
  prefix: string,
  fields: PromptFieldDescriptor[]
): void {
  for (const [name, prop] of Object.entries(properties)) {
    if (typeof prop === "boolean" || !prop) continue;

    // Skip hidden fields
    if ((prop as Record<string, unknown>)["x-ui-hidden"]) continue;

    // Skip const fields — value is fixed
    if ("const" in prop) continue;

    const fullKey = prefix ? `${prefix}.${name}` : name;
    const isRequired = required.has(name);

    // Only prompt for required fields
    if (!isRequired) continue;

    // Skip fields that already have values
    const existingValue = getNestedValue(input, fullKey);
    if (existingValue !== undefined) continue;

    // Skip fields with defaults
    if ("default" in prop) continue;

    const schemaType = prop.type as string | undefined;

    // Recurse into nested objects
    if (schemaType === "object" && "properties" in prop && prop.properties) {
      const nestedRequired = new Set((prop.required as readonly string[] | undefined) ?? []);
      collectMissingFields(
        prop.properties as Record<string, SchemaProperty>,
        nestedRequired,
        input,
        fullKey,
        fields
      );
      continue;
    }

    // Determine prompt type
    let promptType: PromptFieldDescriptor["type"];
    if ("enum" in prop && Array.isArray(prop.enum)) {
      promptType = "enum";
    } else {
      switch (schemaType) {
        case "boolean":
          promptType = "boolean";
          break;
        case "number":
          promptType = "number";
          break;
        case "integer":
          promptType = "integer";
          break;
        case "array":
          promptType = "array";
          break;
        case "object":
          promptType = "object";
          break;
        default:
          promptType = "string";
      }
    }

    const label = (prop.title as string | undefined) ?? formatKeyAsLabel(name);

    fields.push({
      key: fullKey,
      type: promptType,
      label,
      description: prop.description as string | undefined,
      format: (prop as Record<string, unknown>).format as string | undefined,
      enumValues: "enum" in prop && Array.isArray(prop.enum) ? prop.enum : undefined,
      defaultValue: undefined,
      required: true,
    });
  }
}

function formatKeyAsLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolve dynamic options for fields with format annotations (e.g. format: "model").
 * Converts string fields to enum fields with available options from the registry.
 */
async function enrichFieldsWithOptions(
  fields: PromptFieldDescriptor[]
): Promise<PromptFieldDescriptor[]> {
  const hasModelFields = fields.some((f) => f.format && f.format.startsWith("model"));
  if (!hasModelFields) return fields;

  let modelIds: string[] = [];
  try {
    const config = await loadConfig();
    const repo = createModelRepository(config);
    await repo.setupDatabase();

    const taskFilter = fields.find((f) => f.format?.startsWith("model:"))?.format?.slice(6);

    const models = taskFilter
      ? await repo.findModelsByTask(taskFilter)
      : await repo.enumerateAllModels();

    modelIds = (models ?? []).map((m) => m.model_id);
  } catch {
    // If we can't load models, fall through to string input
  }

  if (modelIds.length === 0) return fields;

  return fields.map((field) => {
    if (field.format && field.format.startsWith("model") && field.type === "string") {
      return { ...field, type: "enum" as const, enumValues: modelIds };
    }
    return field;
  });
}

/**
 * Walk schema properties and return descriptors for ALL visible fields,
 * pre-populated with current values from input.
 */
export function getAllFields(
  input: Record<string, unknown>,
  schema: DataPortSchemaObject
): PromptFieldDescriptor[] {
  const fields: PromptFieldDescriptor[] = [];
  const properties = schema.properties ?? {};
  const required = new Set((schema.required as readonly string[] | undefined) ?? []);

  const conditionalRequired = evaluateConditionalRequired(input, schema);
  for (const name of conditionalRequired) {
    required.add(name);
  }

  collectAllFields(properties, required, input, "", fields);
  return fields;
}

function collectAllFields(
  properties: Record<string, SchemaProperty>,
  required: Set<string>,
  input: Record<string, unknown>,
  prefix: string,
  fields: PromptFieldDescriptor[]
): void {
  for (const [name, prop] of Object.entries(properties)) {
    if (typeof prop === "boolean" || !prop) continue;

    // Skip hidden fields
    if ((prop as Record<string, unknown>)["x-ui-hidden"]) continue;

    // Skip const fields — value is fixed, not editable
    if ("const" in prop) continue;

    const fullKey = prefix ? `${prefix}.${name}` : name;
    const isRequired = required.has(name);
    const schemaType = prop.type as string | undefined;

    // Recurse into nested objects
    if (schemaType === "object" && "properties" in prop && prop.properties) {
      const nestedRequired = new Set((prop.required as readonly string[] | undefined) ?? []);
      collectAllFields(
        prop.properties as Record<string, SchemaProperty>,
        nestedRequired,
        input,
        fullKey,
        fields
      );
      continue;
    }

    // Determine prompt type
    let promptType: PromptFieldDescriptor["type"];
    if ("enum" in prop && Array.isArray(prop.enum)) {
      promptType = "enum";
    } else {
      switch (schemaType) {
        case "boolean":
          promptType = "boolean";
          break;
        case "number":
          promptType = "number";
          break;
        case "integer":
          promptType = "integer";
          break;
        case "array":
          promptType = "array";
          break;
        case "object":
          promptType = "object";
          break;
        default:
          promptType = "string";
      }
    }

    const label = (prop.title as string | undefined) ?? formatKeyAsLabel(name);
    const existingValue = getNestedValue(input, fullKey);
    const defaultFromSchema = "default" in prop ? prop.default : undefined;
    const defaultValue = existingValue ?? defaultFromSchema;

    fields.push({
      key: fullKey,
      type: promptType,
      label,
      description: prop.description as string | undefined,
      format: (prop as Record<string, unknown>).format as string | undefined,
      enumValues: "enum" in prop && Array.isArray(prop.enum) ? prop.enum : undefined,
      defaultValue,
      required: isRequired,
    });
  }
}

/**
 * Builds field descriptors for an Ink form (including model/credential option enrichment).
 */
export async function prepareSchemaFormFields(
  input: Record<string, unknown>,
  schema: DataPortSchemaObject
): Promise<PromptFieldDescriptor[]> {
  let fields = getAllFields(input, schema);
  return enrichFieldsWithOptions(fields);
}

export interface PromptEditableInputOptions {
  /** Schema field `key` to focus first (e.g. `"value"` when Key was pre-filled from the CLI). */
  readonly initialFocusedFieldKey?: string;
}

/**
 * Present a full editable form with all schema fields pre-populated from input.
 * Returns the edited values merged with input, or exits if cancelled.
 */
export async function promptEditableInput(
  input: Record<string, unknown>,
  schema: DataPortSchemaObject,
  options?: PromptEditableInputOptions
): Promise<Record<string, unknown>> {
  if (!process.stdin.isTTY) {
    return input;
  }

  const fields = await prepareSchemaFormFields(input, schema);

  const prompted = await renderSchemaPrompt(fields, {
    initialFocusedFieldKey: options?.initialFocusedFieldKey,
  });
  if (prompted === undefined) {
    process.exit(0);
  }
  return deepMerge(input, prompted);
}

/**
 * Prompt the user interactively for missing required fields (TTY only).
 * Loops to handle conditionally required fields that emerge after initial answers.
 * Returns the input with prompted values merged in.
 */
export async function promptMissingInput(
  input: Record<string, unknown>,
  schema: DataPortSchemaObject
): Promise<Record<string, unknown>> {
  if (!process.stdin.isTTY) {
    return input;
  }

  let result = input;

  // Loop to handle conditional requirements (e.g. transport → server_url)
  for (;;) {
    let fields = getMissingFields(result, schema);
    if (fields.length === 0) break;

    fields = await enrichFieldsWithOptions(fields);
    const prompted = await renderSchemaPrompt(fields);
    if (prompted === undefined) {
      // User pressed Escape to cancel
      process.exit(0);
    }
    result = deepMerge(result, prompted);
  }

  return result;
}
