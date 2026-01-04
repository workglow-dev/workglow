/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TypedArray } from "./TypedArray";

/**
 * Calculates the magnitude (L2 norm) of a vector
 */
export function magnitude(arr: TypedArray | number[]): number {
  // @ts-ignore - Vector reduce works but TS doesn't recognize it
  return Math.sqrt(arr.reduce((acc, val) => acc + val * val, 0));
}

/**
 * Calculates the inner (dot) product of two vectors
 */
export function inner(arr1: TypedArray, arr2: TypedArray): number {
  if (arr1.length !== arr2.length) {
    throw new Error("Vectors must have the same length to compute inner product.");
  }
  // @ts-ignore - Vector reduce works but TS doesn't recognize it
  return arr1.reduce((acc, val, i) => acc + val * arr2[i], 0);
}

/**
 * Normalizes a vector to unit length (L2 normalization)
 *
 * @param vector - The vector to normalize
 * @param throwOnZero - If true, throws an error for zero vectors. If false, returns the original vector.
 * @returns Normalized vector with the same type as input
 */
export function normalize(vector: TypedArray, throwOnZero = true, float32 = false): TypedArray {
  const mag = magnitude(vector);

  if (mag === 0) {
    if (throwOnZero) {
      throw new Error("Cannot normalize a zero vector.");
    }
    return vector;
  }

  const normalized = Array.from(vector).map((val) => Number(val) / mag);

  if (float32) {
    return new Float32Array(normalized);
  }

  // Preserve the original Vector type
  if (vector instanceof Float64Array) {
    return new Float64Array(normalized);
  }
  if (vector instanceof Float16Array) {
    return new Float16Array(normalized);
  }
  if (vector instanceof Float32Array) {
    return new Float32Array(normalized);
  }
  if (vector instanceof Int8Array) {
    return new Int8Array(normalized);
  }
  if (vector instanceof Uint8Array) {
    return new Uint8Array(normalized);
  }
  if (vector instanceof Int16Array) {
    return new Int16Array(normalized);
  }
  if (vector instanceof Uint16Array) {
    return new Uint16Array(normalized);
  }
  // For other integer arrays, use Float32Array since normalization produces floats
  return new Float32Array(normalized);
}

/**
 * Normalizes an array of numbers to unit length (L2 normalization)
 *
 * @param values - The array of numbers to normalize
 * @param throwOnZero - If true, throws an error for zero vectors. If false, returns the original array.
 * @returns Normalized array of numbers
 */
export function normalizeNumberArray(values: number[], throwOnZero = false): number[] {
  const norm = magnitude(values);

  if (norm === 0) {
    if (throwOnZero) {
      throw new Error("Cannot normalize a zero vector.");
    }
    return values;
  }

  return values.map((v) => v / norm);
}
