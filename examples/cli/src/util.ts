/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile, writeFile } from "fs/promises";

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
 * Read input from a file path or fall back to stdin.
 * When `filePath` is provided the file is read directly.
 * Otherwise stdin is consumed (returns empty string when stdin is a TTY with no data).
 */
export async function readInput(filePath: string | undefined): Promise<string> {
  if (filePath) {
    return (await readFile(filePath, "utf-8")).trim();
  }
  // If stdin is a TTY (no pipe), return empty so callers can show a usage hint
  if (process.stdin.isTTY) {
    return "";
  }
  return readStdin();
}

/**
 * Write output to a file path or fall back to stdout.
 */
export async function writeOutput(data: string, filePath: string | undefined): Promise<void> {
  if (filePath) {
    await writeFile(filePath, data, "utf-8");
    process.stderr.write(`Output written to ${filePath}\n`);
  } else {
    process.stdout.write(data + "\n");
  }
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
