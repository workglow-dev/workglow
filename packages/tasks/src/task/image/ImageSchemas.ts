/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ColorObject } from "@workglow/util/media";
import type { JsonSchema } from "@workglow/util/schema";
import { FromSchema, FromSchemaDefaultOptions, FromSchemaOptions } from "@workglow/util/schema";

export const ColorSchema = (annotations: Record<string, unknown> = {}) =>
  ({
    type: "object",
    properties: {
      r: { type: "integer", minimum: 0, maximum: 255, title: "Red" },
      g: { type: "integer", minimum: 0, maximum: 255, title: "Green" },
      b: { type: "integer", minimum: 0, maximum: 255, title: "Blue" },
      a: { type: "integer", minimum: 0, maximum: 255, title: "Alpha", default: 255 },
    },
    required: ["r", "g", "b"],
    format: "color",
    additionalProperties: false,
    ...annotations,
  }) as const;

export const HexColorSchema = (annotations: Record<string, unknown> = {}) =>
  ({
    type: "string",
    format: "color",
    pattern: "^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$",
    title: "Color (hex)",
    description: "Color as a `#RRGGBB[AA]` or `#RGB[A]` hex string",
    ...annotations,
  }) as const;

/** Accept a {@link ColorObject} or a `#RRGGBB[AA]`/`#RGB[A]` hex string. */
export const ColorValueSchema = (annotations: Record<string, unknown> = {}) =>
  ({
    oneOf: [
      ColorSchema(),
      HexColorSchema({
        title: (annotations.title as string | undefined) ?? "Color",
        description:
          (annotations.description as string | undefined) ??
          "Color as {r,g,b,a} object or `#RRGGBB[AA]` / `#RGB[A]` hex string",
      }),
    ],
    ...annotations,
  }) as const;

// Type-only sentinel for FromSchema deserialize patterns, mirroring ImageBinaryType.
const ColorObjectType = null as any as ColorObject;

export const ColorFromSchemaOptions = {
  ...FromSchemaDefaultOptions,
  deserialize: [
    {
      pattern: { type: "object", format: "color" },
      output: ColorObjectType,
    },
  ],
} as const satisfies FromSchemaOptions;

export type ColorFromSchemaOptions = typeof ColorFromSchemaOptions;

export type ColorFromSchema<SCHEMA extends JsonSchema> = FromSchema<SCHEMA, ColorFromSchemaOptions>;
