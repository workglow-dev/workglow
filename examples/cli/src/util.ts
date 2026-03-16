/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeFile } from "fs/promises";

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
  const code = (err as unknown as Record<string, unknown>).code;
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
