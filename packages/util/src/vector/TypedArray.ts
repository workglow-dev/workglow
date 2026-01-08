/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FromSchema, FromSchemaDefaultOptions, FromSchemaOptions } from "../json-schema/FromSchema";
import { JsonSchema } from "../json-schema/JsonSchema";

/**
 * Supported typed array types
 * - Float16Array: 16-bit floating point (medium precision)
 * - Float32Array: Standard 32-bit floating point (most common)
 * - Float64Array: 64-bit floating point (high precision)
 * - Int8Array: 8-bit signed integer (binary quantization)
 * - Uint8Array: 8-bit unsigned integer (quantization)
 * - Int16Array: 16-bit signed integer (quantization)
 * - Uint16Array: 16-bit unsigned integer (quantization)
 */
export type TypedArray =
  | Float32Array
  | Float16Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array;

export type TypedArrayString =
  | `${"Float"}${16 | 32 | 64}Array`
  | `Int${16 | 8}Array`
  | `Uint${16 | 8}Array`;

// Type-only value for use in deserialize patterns
const TypedArrayType = null as any as TypedArray;

const TypedArraySchemaOptions = {
  ...FromSchemaDefaultOptions,
  deserialize: [
    {
      pattern: {
        format: "TypedArray:Float64Array",
      },
      output: Float64Array,
    },
    {
      pattern: {
        format: "TypedArray:Float32Array",
      },
      output: Float32Array,
    },
    {
      pattern: {
        format: "TypedArray:Float16Array",
      },
      output: Float16Array,
    },
    {
      pattern: {
        format: "TypedArray:Int16Array",
      },
      output: Int16Array,
    },
    {
      pattern: {
        format: "TypedArray:Int8Array",
      },
      output: Int8Array,
    },
    {
      pattern: {
        format: "TypedArray:Uint8Array",
      },
      output: Uint8Array,
    },
    {
      pattern: {
        format: "TypedArray:Uint16Array",
      },
      output: Uint16Array,
    },
    {
      pattern: { format: "TypedArray" },
      output: TypedArrayType,
    },
  ],
} as const satisfies FromSchemaOptions;

export type TypedArraySchemaOptions = typeof TypedArraySchemaOptions;

export type VectorFromSchema<SCHEMA extends JsonSchema> = FromSchema<
  SCHEMA,
  TypedArraySchemaOptions
>;

export const TypedArraySchema = (
  annotations: Record<string, unknown> = {},
  subtype?: TypedArrayString
) =>
  ({
    type: "array",
    items: { type: "number" },
    format: `TypedArray${subtype ? `:${subtype}` : ""}`,
    title: subtype ? `Typed Array (${subtype})` : "Typed Array",
    description: subtype
      ? `A typed array (${subtype})`
      : "A typed array (Float32Array, Int8Array, etc.)",
    ...annotations,
  }) as const satisfies JsonSchema;
