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
 * For negative values, normalizes by finding the global min and shifting to non-negative range
 */
export function jaccardSimilarity(a: TypedArray, b: TypedArray): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
  }

  // Find global min across both vectors to handle negative values
  let globalMin = a[0];
  for (let i = 0; i < a.length; i++) {
    globalMin = Math.min(globalMin, a[i], b[i]);
  }

  // Shift values to non-negative range if needed
  const shift = globalMin < 0 ? -globalMin : 0;

  let minSum = 0;
  let maxSum = 0;

  for (let i = 0; i < a.length; i++) {
    const shiftedA = a[i] + shift;
    const shiftedB = b[i] + shift;
    minSum += Math.min(shiftedA, shiftedB);
    maxSum += Math.max(shiftedA, shiftedB);
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
