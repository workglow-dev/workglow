/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JsonSchema } from "@workglow/util/schema";
import type { TransformDef } from "../TransformRegistry";

export interface PickParams {
  readonly path: string;
}

function traverseSchema(schema: JsonSchema, path: string): JsonSchema {
  if (!path) return schema;
  if (typeof schema === "boolean") return schema;
  const segments = path.split(".");
  let current: JsonSchema = schema;
  for (const segment of segments) {
    if (typeof current === "boolean") return current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = current as any;
    const props: Record<string, JsonSchema> | undefined = obj.properties;
    const next: JsonSchema | undefined = props?.[segment];
    if (next === undefined) {
      return obj.additionalProperties === true ? true : false;
    }
    current = next;
  }
  return current;
}

function traverseValue(value: unknown, path: string): unknown {
  if (!path) return value;
  const segments = path.split(".");
  let current: unknown = value;
  for (const segment of segments) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export const PickTransform: TransformDef<PickParams> = {
  id: "pick",
  title: "Pick property",
  category: "Structural",
  paramsSchema: {
    type: "object",
    properties: {
      path: { type: "string", title: "Property path", description: "Dot-separated path, e.g. 'customer.created_at'" },
    },
    required: ["path"],
  },
  inferOutputSchema(inputSchema, params) {
    return traverseSchema(inputSchema, params.path);
  },
  apply(value, params) {
    return traverseValue(value, params.path);
  },
  applyStream(chunk, params) {
    return traverseValue(chunk, params.path);
  },
  suggestFromSchemas(source, target) {
    if (typeof source === "boolean") return undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const src = source as any;
    if (src.type !== "object") return undefined;
    const props: Record<string, JsonSchema> | undefined = src.properties;
    if (!props) return undefined;
    for (const [key, propSchema] of Object.entries(props)) {
      if (isPlausiblyCompatible(propSchema, target)) {
        return { score: 0.7, params: { path: key } };
      }
    }
    return undefined;
  },
};

function isPlausiblyCompatible(source: JsonSchema, target: JsonSchema): boolean {
  if (typeof source === "boolean" || typeof target === "boolean") return true;
  const sourceType = (source as { type?: unknown }).type;
  const targetType = (target as { type?: unknown }).type;
  if (sourceType === targetType) return true;
  return false;
}
