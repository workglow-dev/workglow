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
  | "TypedArray"
  | "TypedArray:Float16Array"
  | "TypedArray:Float32Array"
  | "TypedArray:Float64Array"
  | "TypedArray:Int8Array"
  | "TypedArray:Uint8Array"
  | "TypedArray:Int16Array"
  | "TypedArray:Uint16Array";

// Type-only value for use in deserialize patterns
const TypedArrayType = null as any as TypedArray;

const TypedArraySchemaOptions = {
  ...FromSchemaDefaultOptions,
  deserialize: [
    {
      pattern: { type: "array", format: "TypedArray:Float64Array" },
      output: Float64Array,
    },
    {
      pattern: { type: "array", format: "TypedArray:Float32Array" },
      output: Float32Array,
    },
    {
      pattern: { type: "array", format: "TypedArray:Float16Array" },
      output: Float16Array,
    },
    {
      pattern: { type: "array", format: "TypedArray:Int16Array" },
      output: Int16Array,
    },
    {
      pattern: { type: "array", format: "TypedArray:Int8Array" },
      output: Int8Array,
    },
    {
      pattern: { type: "array", format: "TypedArray:Uint8Array" },
      output: Uint8Array,
    },
    {
      pattern: { type: "array", format: "TypedArray:Uint16Array" },
      output: Uint16Array,
    },
    {
      pattern: { type: "array", format: "TypedArray" },
      output: TypedArrayType,
    },
  ],
} as const satisfies FromSchemaOptions;

export type TypedArraySchemaOptions = typeof TypedArraySchemaOptions;

export type VectorFromSchema<SCHEMA extends JsonSchema> = FromSchema<
  SCHEMA,
  TypedArraySchemaOptions
>;

export const TypedArraySchema = (annotations: Record<string, unknown> = {}) => {
  return {
    type: "array",
    format: "TypedArray",
    title: "Typed Array",
    description: "A typed array (Float32Array, Int8Array, etc.)",
    ...annotations,
  } as const satisfies JsonSchema;
};
