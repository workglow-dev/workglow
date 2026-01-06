/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FromSchemaDefaultOptions, FromSchemaOptions } from "../json-schema/FromSchema";
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

// Type-only value for use in deserialize patterns
const TypedArrayType = null as any as TypedArray;

const TypedArraySchemaOptions = {
  ...FromSchemaDefaultOptions,
  deserialize: [
    // {
    //   pattern: {
    //     type: "number";
    //     "format": "Float64Array";
    //   };
    //   output: Float64Array;
    // },
    // {
    //   pattern: {
    //     type: "number";
    //     "format": "Float32Array";
    //   };
    //   output: Float32Array;
    // },
    // {
    //   pattern: {
    //     type: "number";
    //     "format": "Float16Array";
    //   };
    //   output: Float16Array;
    // },
    // {
    //   pattern: {
    //     type: "number";
    //     "format": "Int16Array";
    //   };
    //   output: Int16Array;
    // },
    // {
    //   pattern: {
    //     type: "number";
    //     "format": "Int8Array";
    //   };
    //   output: Int8Array;
    // },
    // {
    //   pattern: {
    //     type: "number";
    //     "format": "Uint8Array";
    //   };
    //   output: Uint8Array;
    // },
    // {
    //   pattern: {
    //     type: "number";
    //     "format": "Uint16Array";
    //   };
    //   output: Uint16Array;
    // },
    {
      pattern: { format: "TypedArray" },
      output: TypedArrayType,
    },
  ],
} as const satisfies FromSchemaOptions;

export type TypedArraySchemaOptions = typeof TypedArraySchemaOptions;

export const TypedArraySchema = (annotations: Record<string, unknown> = {}) =>
  ({
    type: "array",
    items: { type: "number" },
    format: "TypedArray",
    title: "Typed Array",
    description: "A typed array (Float32Array, Int8Array, etc.) or regular number array",
    ...annotations,
  }) as const satisfies JsonSchema;
