/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { sha256 } from "@workglow/util";

import type { VariantProvenance } from "./DocumentSchema";

/**
 * Default maximum tokens for chunking when not specified in provenance
 */
const DEFAULT_MAX_TOKENS = 512;

/**
 * Generate configId from variant provenance
 */
export async function deriveConfigId(provenance: VariantProvenance): Promise<string> {
  const configFields = provenance;

  // Sort keys for canonical JSON
  const canonical = JSON.stringify(sortObject(configFields));
  const hash = await sha256(canonical);
  return `cfg_${hash.substring(0, 16)}`;
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
 * Check if two configIds represent the same variant
 */
export function isSameVariant(configId1: string, configId2: string): boolean {
  return configId1 === configId2;
}

