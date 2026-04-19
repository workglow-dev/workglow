/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JsonSchema } from "@workglow/util/schema";
import { TransformRegistry, type TransformDef } from "../TransformRegistry";
import { PickTransform } from "./pick";

export { PickTransform } from "./pick";

export interface IndexParams {
  readonly index: number;
}

export const IndexTransform: TransformDef<IndexParams> = {
  id: "index",
  title: "Index into array",
  category: "Structural",
  paramsSchema: {
    type: "object",
    properties: {
      index: { type: "number", title: "Index", description: "Zero-based array index" },
    },
    required: ["index"],
  },
  inferOutputSchema(inputSchema) {
    if (typeof inputSchema === "boolean") return inputSchema;
    if ((inputSchema as { type?: unknown }).type !== "array") return false;
    const items = (inputSchema as { items?: JsonSchema | readonly JsonSchema[] }).items;
    if (items === undefined) return true;
    if (Array.isArray(items)) return items[0] ?? true;
    return items as JsonSchema;
  },
  apply(value, params) {
    if (!Array.isArray(value)) return undefined;
    const i = params.index < 0 ? value.length + params.index : params.index;
    return value[i];
  },
  applyStream(chunk, params) {
    if (!Array.isArray(chunk)) return undefined;
    const i = params.index < 0 ? chunk.length + params.index : params.index;
    return chunk[i];
  },
  suggestFromSchemas(source, target) {
    if (typeof source === "boolean") return undefined;
    const src = source as { type?: unknown; items?: JsonSchema | readonly JsonSchema[] };
    if (src.type !== "array") return undefined;
    const items = src.items;
    if (items === undefined) return undefined;
    const itemSchema: JsonSchema = Array.isArray(items) ? items[0] ?? true : (items as JsonSchema);
    if (schemaLooseMatch(itemSchema, target)) {
      return { score: 0.6, params: { index: 0 } };
    }
    return undefined;
  },
};

export interface CoalesceParams {
  readonly defaultValue: unknown;
}

export const CoalesceTransform: TransformDef<CoalesceParams> = {
  id: "coalesce",
  title: "Coalesce null",
  category: "Structural",
  paramsSchema: {
    type: "object",
    properties: {
      defaultValue: { title: "Default value", description: "Returned when the input is null or undefined" },
    },
    required: ["defaultValue"],
  },
  inferOutputSchema(inputSchema) {
    return inputSchema;
  },
  apply(value, params) {
    return value == null ? params.defaultValue : value;
  },
};

export const UppercaseTransform: TransformDef<Record<string, never>> = {
  id: "uppercase",
  title: "Uppercase",
  category: "String",
  inferOutputSchema() {
    return { type: "string" } as const satisfies JsonSchema;
  },
  apply(value) {
    return String(value).toUpperCase();
  },
};

export const LowercaseTransform: TransformDef<Record<string, never>> = {
  id: "lowercase",
  title: "Lowercase",
  category: "String",
  inferOutputSchema() {
    return { type: "string" } as const satisfies JsonSchema;
  },
  apply(value) {
    return String(value).toLowerCase();
  },
};

export interface TruncateParams {
  readonly max: number;
}

export const TruncateTransform: TransformDef<TruncateParams> = {
  id: "truncate",
  title: "Truncate",
  category: "String",
  paramsSchema: {
    type: "object",
    properties: {
      max: { type: "number", title: "Max length" },
    },
    required: ["max"],
  },
  inferOutputSchema() {
    return { type: "string" } as const satisfies JsonSchema;
  },
  apply(value, params) {
    const s = String(value);
    return s.length > params.max ? s.slice(0, params.max) : s;
  },
};

export interface SubstringParams {
  readonly start: number;
  readonly end?: number;
}

export const SubstringTransform: TransformDef<SubstringParams> = {
  id: "substring",
  title: "Substring",
  category: "String",
  paramsSchema: {
    type: "object",
    properties: {
      start: { type: "number", title: "Start" },
      end: { type: "number", title: "End (optional)" },
    },
    required: ["start"],
  },
  inferOutputSchema() {
    return { type: "string" } as const satisfies JsonSchema;
  },
  apply(value, params) {
    return String(value).slice(params.start, params.end);
  },
};

export interface UnixToIsoDateParams {
  readonly unit: "s" | "ms";
}

export const UnixToIsoDateTransform: TransformDef<UnixToIsoDateParams> = {
  id: "unixToIsoDate",
  title: "Unix timestamp to ISO date",
  category: "Date",
  paramsSchema: {
    type: "object",
    properties: {
      unit: { type: "string", title: "Unit", enum: ["s", "ms"] },
    },
    required: ["unit"],
  },
  inferOutputSchema() {
    return { type: "string", format: "date-time" } as const satisfies JsonSchema;
  },
  apply(value, params) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new Error(`unixToIsoDate: expected a number, got ${typeof value}`);
    }
    const ms = params.unit === "s" ? n * 1000 : n;
    return new Date(ms).toISOString();
  },
  suggestFromSchemas(source, target) {
    if (typeof target === "boolean" || typeof source === "boolean") return undefined;
    const sType = (source as { type?: unknown }).type;
    const tType = (target as { type?: unknown }).type;
    if (sType !== "number" && sType !== "integer") return undefined;
    if (tType !== "string") return undefined;
    const targetFormat = (target as { format?: string }).format;
    if (targetFormat !== "date-time" && targetFormat !== "date") return undefined;
    return { score: 0.9, params: { unit: "s" } };
  },
};

export const NumberToStringTransform: TransformDef<Record<string, never>> = {
  id: "numberToString",
  title: "Number to string",
  category: "Cast",
  inferOutputSchema() {
    return { type: "string" } as const satisfies JsonSchema;
  },
  apply(value) {
    if (typeof value !== "number" && typeof value !== "bigint") {
      throw new Error(`numberToString: expected number, got ${typeof value}`);
    }
    return String(value);
  },
  suggestFromSchemas(source, target) {
    if (typeof source === "boolean" || typeof target === "boolean") return undefined;
    const sType = (source as { type?: unknown }).type;
    const tType = (target as { type?: unknown }).type;
    if ((sType === "number" || sType === "integer") && tType === "string") {
      const targetFormat = (target as { format?: string }).format;
      if (targetFormat && targetFormat !== "") return undefined;
      return { score: 0.8, params: {} };
    }
    return undefined;
  },
};

export const ParseJsonTransform: TransformDef<Record<string, never>> = {
  id: "parseJson",
  title: "Parse JSON",
  category: "Cast",
  inferOutputSchema() {
    return true;
  },
  apply(value) {
    if (typeof value !== "string") {
      throw new Error(`parseJson: expected string, got ${typeof value}`);
    }
    return JSON.parse(value);
  },
};

export const StringifyTransform: TransformDef<Record<string, never>> = {
  id: "stringify",
  title: "Stringify JSON",
  category: "Cast",
  inferOutputSchema() {
    return { type: "string" } as const satisfies JsonSchema;
  },
  apply(value) {
    return JSON.stringify(value);
  },
};

export const ToBooleanTransform: TransformDef<Record<string, never>> = {
  id: "toBoolean",
  title: "To boolean",
  category: "Cast",
  inferOutputSchema() {
    return { type: "boolean" } as const satisfies JsonSchema;
  },
  apply(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
      if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "") return false;
      throw new Error(`toBoolean: cannot coerce "${value}"`);
    }
    throw new Error(`toBoolean: unsupported type ${typeof value}`);
  },
};

const BUILT_IN_TRANSFORMS: readonly TransformDef<unknown>[] = [
  PickTransform as unknown as TransformDef<unknown>,
  IndexTransform as unknown as TransformDef<unknown>,
  CoalesceTransform as unknown as TransformDef<unknown>,
  UppercaseTransform as unknown as TransformDef<unknown>,
  LowercaseTransform as unknown as TransformDef<unknown>,
  TruncateTransform as unknown as TransformDef<unknown>,
  SubstringTransform as unknown as TransformDef<unknown>,
  UnixToIsoDateTransform as unknown as TransformDef<unknown>,
  NumberToStringTransform as unknown as TransformDef<unknown>,
  ParseJsonTransform as unknown as TransformDef<unknown>,
  StringifyTransform as unknown as TransformDef<unknown>,
  ToBooleanTransform as unknown as TransformDef<unknown>,
];

/**
 * Registers every built-in transform with the global {@link TransformRegistry}.
 * Idempotent — safe to call multiple times.
 */
export function registerBuiltInTransforms(): void {
  for (const def of BUILT_IN_TRANSFORMS) {
    TransformRegistry.registerTransform(def);
  }
}

function schemaLooseMatch(source: JsonSchema, target: JsonSchema): boolean {
  if (typeof source === "boolean" || typeof target === "boolean") return true;
  const sType = (source as { type?: unknown }).type;
  const tType = (target as { type?: unknown }).type;
  return sType === tType;
}
