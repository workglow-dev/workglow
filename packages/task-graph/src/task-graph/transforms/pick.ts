/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";
import { areSemanticallyCompatible } from "@workglow/util/schema";
import type { ITransformDef } from "../TransformTypes";

interface PickParams {
  readonly path: string;
}

function walk(value: unknown, path: string): unknown {
  if (value == null) return undefined;
  const parts = path.split(".");
  let cur: any = value;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function walkSchema(schema: DataPortSchema, path: string): DataPortSchema {
  const parts = path.split(".");
  let cur: any = schema;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return {} as DataPortSchema;
    if (cur.type !== "object" || !cur.properties || !cur.properties[p]) {
      return {} as DataPortSchema;
    }
    cur = cur.properties[p];
  }
  return cur as DataPortSchema;
}

export const pickTransform: ITransformDef<PickParams> = {
  id: "pick",
  title: "Pick field",
  category: "Structural",
  paramsSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Dotted property path" },
    },
    required: ["path"],
  } as DataPortSchema,

  inferOutputSchema(inputSchema, params) {
    return walkSchema(inputSchema, params.path);
  },

  apply(value, params) {
    return walk(value, params.path);
  },

  suggestFromSchemas(source, target) {
    if ((source as any).type !== "object" || !(source as any).properties) {
      return undefined;
    }
    const props = (source as any).properties as Record<string, DataPortSchema>;
    // Prefer exact leaf match; fall back to first compatible property.
    for (const [name, propSchema] of Object.entries(props)) {
      const compat = areSemanticallyCompatible(propSchema, target);
      if (compat === "static") return { score: 1.0, params: { path: name } };
      if (compat === "runtime") return { score: 0.6, params: { path: name } };
    }
    return undefined;
  },
};
