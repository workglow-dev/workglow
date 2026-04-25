/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";
import type { ITransformDef } from "../TransformTypes";

interface CoalesceParams {
  readonly defaultValue: unknown;
}

function stripNullable(schema: DataPortSchema): DataPortSchema {
  const s = schema as any;
  if (!s || typeof s !== "object") return schema;
  if (Array.isArray(s.type)) {
    const nonNull = s.type.filter((t: string) => t !== "null");
    if (nonNull.length === 1) return { ...s, type: nonNull[0] } as DataPortSchema;
    return { ...s, type: nonNull } as DataPortSchema;
  }
  return schema;
}

export const coalesceTransform: ITransformDef<CoalesceParams> = {
  id: "coalesce",
  title: "Coalesce null",
  category: "Conversion",
  paramsSchema: {
    type: "object",
    properties: { defaultValue: {} },
    required: ["defaultValue"],
  } as DataPortSchema,
  inferOutputSchema: (input) => stripNullable(input),
  apply: (v, { defaultValue }) => (v == null ? defaultValue : v),
};
