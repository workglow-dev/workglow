/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageBinary } from "@workglow/util/media";
import type { JsonSchema } from "@workglow/util/schema";
import {
  FromSchema,
  FromSchemaDefaultOptions,
  FromSchemaOptions,
} from "@workglow/util/schema";

// Type-only value for use in deserialize patterns
const ImageBinaryType = null as any as ImageBinary;

export const ImageBinarySchemaOptions = {
  ...FromSchemaDefaultOptions,
  deserialize: [
    {
      pattern: { type: "object", format: "image:ImageBinary" },
      output: ImageBinaryType,
    },
  ],
} as const satisfies FromSchemaOptions;

export type ImageBinarySchemaOptions = typeof ImageBinarySchemaOptions;

export type ImageFromSchema<SCHEMA extends JsonSchema> = FromSchema<
  SCHEMA,
  ImageBinarySchemaOptions
>;

export const ImageBinarySchema = (annotations: Record<string, unknown> = {}) =>
  ({
    type: "object",
    properties: {
      data: {
        type: "array",
        items: { type: "number", format: "Uint8Clamped" },
        format: "Uint8ClampedArray",
        title: "Data",
        description: "Pixel data of the image",
      },
      width: { type: "number", title: "Width", description: "Width in pixels" },
      height: { type: "number", title: "Height", description: "Height in pixels" },
      channels: {
        type: "number",
        title: "Channels",
        description: "1 (gray), 3 (RGB), or 4 (RGBA)",
      },
    },
    additionalProperties: false,
    required: ["data", "width", "height", "channels"],
    format: "image:ImageBinary",
    title: "Image",
    description: "Raw pixel image data",
    ...annotations,
  }) as const;

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
    additionalProperties: false,
    ...annotations,
  }) as const;
