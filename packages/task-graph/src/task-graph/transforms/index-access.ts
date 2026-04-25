/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";
import { areSemanticallyCompatible } from "@workglow/util/schema";
import type { ITransformDef } from "../TransformTypes";

interface IndexParams {
  readonly index: number;
}

function doIndex(value: unknown, idx: number): unknown {
  if (!Array.isArray(value)) return undefined;
  const i = idx < 0 ? value.length + idx : idx;
  return value[i];
}

export const indexTransform: ITransformDef<IndexParams> = {
  id: "index",
  title: "Array index",
  category: "Structural",
  paramsSchema: {
    type: "object",
    properties: {
      index: { type: "integer", description: "Array index (negative counts from end)" },
    },
    required: ["index"],
  } as DataPortSchema,

  inferOutputSchema(inputSchema) {
    const s = inputSchema as any;
    if (s?.type === "array" && s.items) return s.items as DataPortSchema;
    return {} as DataPortSchema;
  },

  apply(value, params) {
    return doIndex(value, params.index);
  },

  suggestFromSchemas(source, target) {
    const s = source as any;
    if (s?.type !== "array" || !s.items) return undefined;
    const compat = areSemanticallyCompatible(s.items, target);
    if (compat === "static") return { score: 0.9, params: { index: 0 } };
    if (compat === "runtime") return { score: 0.5, params: { index: 0 } };
    return undefined;
  },
};
