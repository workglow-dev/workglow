/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Provenance } from "@workglow/task-graph";
import { sha256 } from "@workglow/util";

import type { VariantProvenance } from "./DocumentSchema";

/**
 * Default maximum tokens for chunking when not specified in provenance
 */
const DEFAULT_MAX_TOKENS = 512;

/**
 * Extract variant-relevant fields from task-graph provenance
 */
export function extractConfigFields(provenance: Provenance): VariantProvenance {
  return {
    embeddingModel: extractString(provenance, "embeddingModel", "model", "embedding_model"),
    chunkerStrategy: extractString(provenance, "chunkerStrategy", "strategy", "chunking_strategy"),
    maxTokens: extractNumber(provenance, "maxTokens", "max_tokens", "chunkSize", "chunk_size"),
    overlap: extractNumber(
      provenance,
      "overlap",
      "overlapTokens",
      "overlap_tokens",
      "chunkOverlap"
    ),
    summaryModel: extractOptionalString(provenance, "summaryModel", "summary_model"),
    nerModel: extractOptionalString(provenance, "nerModel", "ner_model"),
  };
}

/**
 * Generate configId from variant provenance
 */
export async function deriveConfigId(provenance: Provenance | VariantProvenance): Promise<string> {
  const configFields =
    "embeddingModel" in provenance && typeof provenance.embeddingModel === "string"
      ? (provenance as VariantProvenance)
      : extractConfigFields(provenance as Provenance);

  // Sort keys for canonical JSON
  const canonical = JSON.stringify(sortObject(configFields));
  const hash = await sha256(canonical);
  return `cfg_${hash.substring(0, 16)}`;
}

/**
 * Helper to extract string value from provenance (tries multiple key names)
 */
function extractString(prov: Provenance, ...keys: string[]): string {
  for (const key of keys) {
    const value = prov[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    // Handle nested objects
    if (typeof value === "object" && value !== null) {
      const nested = extractFromNested(value as Record<string, unknown>, ...keys);
      if (nested) return nested;
    }
  }
  // Default for required field
  return keys[0];
}

/**
 * Helper to extract number value from provenance
 */
function extractNumber(prov: Provenance, ...keys: string[]): number {
  for (const key of keys) {
    const value = prov[key];
    if (typeof value === "number") {
      return value;
    }
    // Handle nested objects
    if (typeof value === "object" && value !== null) {
      const nested = extractNumberFromNested(value as Record<string, unknown>, ...keys);
      if (nested !== undefined) return nested;
    }
  }
  // Default for required field
  return DEFAULT_MAX_TOKENS;
}

/**
 * Helper to extract optional string value
 */
function extractOptionalString(prov: Provenance, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = prov[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    // Handle nested objects
    if (typeof value === "object" && value !== null) {
      const nested = extractFromNested(value as Record<string, unknown>, ...keys);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * Extract string from nested object
 */
function extractFromNested(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Extract number from nested object
 */
function extractNumberFromNested(
  obj: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number") {
      return value;
    }
  }
  return undefined;
}

/**
 * Sort object keys recursively for canonical JSON
 */
function sortObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sortObject(item));
  }
  if (typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(record).sort();
    for (const key of keys) {
      sorted[key] = sortObject(record[key]);
    }
    return sorted;
  }
  return obj;
}

/**
 * Merge provenance from multiple tasks (used when combining results)
 */
export function mergeProvenance(...provenances: Provenance[]): Provenance {
  const merged: Record<string, unknown> = {};
  for (const prov of provenances) {
    Object.assign(merged, prov);
  }
  return merged as Provenance;
}

/**
 * Check if two configIds represent the same variant
 */
export function isSameVariant(configId1: string, configId2: string): boolean {
  return configId1 === configId2;
}

/**
 * Check if provenance contains all required fields for variant identification
 */
export function hasVariantFields(provenance: Provenance): boolean {
  try {
    const fields = extractConfigFields(provenance);
    return (
      fields.embeddingModel.length > 0 &&
      fields.chunkerStrategy.length > 0 &&
      fields.maxTokens > 0 &&
      fields.overlap >= 0
    );
  } catch {
    return false;
  }
}
