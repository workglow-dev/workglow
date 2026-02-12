/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TypedArray } from "./TypedArray";

/** Width ranking: higher = wider type (more precision). Float64 > Float32 > Float16 > Int16 > Int8. */
const WIDTH_RANK: Record<string, number> = {
  Float64Array: 6,
  Float32Array: 5,
  Float16Array: 4,
  Int16Array: 3,
  Uint16Array: 3,
  Int8Array: 2,
  Uint8Array: 2,
};

function getWidthRank(arr: TypedArray): number {
  return WIDTH_RANK[arr.constructor.name] ?? 0;
}

/**
 * Returns the widest (highest-precision) TypedArray constructor among the given sources.
 * E.g. Int8Array × Float32Array → Float32Array.
 */
function widestConstructor(sources: TypedArray[]): new (len: number) => TypedArray {
  let best = sources[0];
  for (let i = 1; i < sources.length; i++) {
    if (getWidthRank(sources[i]) > getWidthRank(best)) best = sources[i];
  }
  return best.constructor as new (len: number) => TypedArray;
}

/**
 * Creates a new TypedArray with the widest type among the given sources,
 * filled with the provided values. Use when combining multiple vectors
 * (e.g. a * b) so output precision matches the widest input.
 */
export function createTypedArrayFrom(sources: TypedArray[], values: number[]): TypedArray {
  const Ctor = widestConstructor(sources);
  const result = new Ctor(values.length);
  for (let i = 0; i < values.length; i++) result[i] = values[i];
  return result;
}
