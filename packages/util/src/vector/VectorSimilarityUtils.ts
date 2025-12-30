/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TypedArray } from "./TypedArray";

/**
 * Calculates cosine similarity between two vectors
 * Returns a value between -1 and 1, where 1 means identical direction
 */
export function cosineSimilarity(a: TypedArray, b: TypedArray): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }
  return dotProduct / denominator;
}

/**
 * Calculates Jaccard similarity between two vectors
 * Uses the formula: sum(min(a[i], b[i])) / sum(max(a[i], b[i]))
 * Returns a value between 0 and 1
 */
export function jaccardSimilarity(a: TypedArray, b: TypedArray): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
  }

  let minSum = 0;
  let maxSum = 0;

  for (let i = 0; i < a.length; i++) {
    minSum += Math.min(a[i], b[i]);
    maxSum += Math.max(a[i], b[i]);
  }

  return maxSum === 0 ? 0 : minSum / maxSum;
}

/**
 * Calculates Hamming distance between two vectors (normalized)
 * Counts the number of positions where vectors differ
 * Returns a value between 0 and 1 (0 = identical, 1 = completely different)
 */
export function hammingDistance(a: TypedArray, b: TypedArray): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
  }

  let differences = 0;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      differences++;
    }
  }

  return differences / a.length;
}

/**
 * Calculates Hamming similarity (inverse of distance)
 * Returns a value between 0 and 1 (1 = identical, 0 = completely different)
 */
export function hammingSimilarity(a: TypedArray, b: TypedArray): number {
  return 1 - hammingDistance(a, b);
}
