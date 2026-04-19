/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeFile } from "fs/promises";

const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Set a value on an object using dot-notation key (e.g. "a.b.c").
 * Creates intermediate objects as needed. Skips keys that could cause prototype pollution.
 */
export function setNestedValue(obj: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split(".");
  for (const part of parts) {
    if (PROTOTYPE_POLLUTION_KEYS.has(part)) return;
  }
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== "object") {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Get a value from an object using dot-notation key (e.g. "a.b.c").
 * Returns undefined if any segment is missing or if the key would touch prototype-pollution-sensitive properties.
 */
export function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  const parts = key.split(".");
  for (const part of parts) {
    if (PROTOTYPE_POLLUTION_KEYS.has(part)) return undefined;
  }
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Read all of stdin as a string.
 */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

/**
 * Write result as JSON to a file or stdout.
 */
export async function outputResult(result: unknown, outputJsonFile?: string): Promise<void> {
  const json = JSON.stringify(result, null, 2);
  if (outputJsonFile) {
    await writeFile(outputJsonFile, json, "utf-8");
  } else {
    console.log(json);
  }
}

/**
 * Format a task/workflow execution error for clean user-facing output.
 * Strips stack traces and source code snippets, showing only the message.
 */
export function formatError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  let message = err.message;

  // Include error code if present (e.g. ERR_INVALID_URL, HTTP status codes)
  const code = "code" in err ? err.code : undefined;
  if (code !== undefined && code !== -1) {
    message = `${message} (${code})`;
  }

  return message;
}

/**
 * Format an array of objects as a simple aligned table.
 */
export function formatTable(rows: Record<string, string>[], columns: string[]): string {
  if (rows.length === 0) return "(none)";

  const widths = columns.map((col) =>
    Math.max(col.length, ...rows.map((row) => (row[col] ?? "").length))
  );

  const header = columns.map((col, i) => col.padEnd(widths[i])).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows
    .map((row) => columns.map((col, i) => (row[col] ?? "").padEnd(widths[i])).join("  "))
    .join("\n");

  return `${header}\n${separator}\n${body}`;
}
