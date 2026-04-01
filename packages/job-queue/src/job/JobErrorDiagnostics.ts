/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** Appended to job error messages; {@link JobQueueClient.buildErrorFromCode} maps this back onto `.stack`. */
export const JOB_ERROR_DIAGNOSTICS_MARKER = "\n\n--- Error diagnostics ---\n";

const DEFAULT_MAX_DIAGNOSTICS_CHARS = 48_000;

/**
 * Formats an error and its `.cause` chain (name, message, stack) for logs and persisted job errors.
 */
export function formatErrorChainForDiagnostics(
  err: unknown,
  maxChars: number = DEFAULT_MAX_DIAGNOSTICS_CHARS
): string {
  const lines: string[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current != null; depth++) {
    if (current instanceof Error) {
      lines.push(`${current.name}: ${current.message}`);
      if (current.stack) {
        lines.push(current.stack);
      }
      const next = current.cause;
      if (next === undefined || next === null) {
        break;
      }
      lines.push("");
      current = next;
    } else {
      lines.push(typeof current === "string" ? current : String(current));
      break;
    }
  }
  const text = lines.join("\n");
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n…(truncated)`;
}

/**
 * Combines a short summary line with a full diagnostic dump (for storage on the failed job).
 */
export function withJobErrorDiagnostics(summaryLine: string, err: unknown): string {
  const diag = formatErrorChainForDiagnostics(err);
  if (diag.length === 0) {
    return summaryLine;
  }
  return `${summaryLine}${JOB_ERROR_DIAGNOSTICS_MARKER}${diag}`;
}

/**
 * When a persisted job error includes {@link JOB_ERROR_DIAGNOSTICS_MARKER}, set `.stack` so runtimes
 * (e.g. Vitest) print the worker-side trace instead of only the queue client frames.
 */
export function applyPersistedDiagnosticsToStack(
  jobError: JobErrorLike,
  fullMessage: string
): void {
  if (!fullMessage.includes("--- Error diagnostics ---")) {
    return;
  }
  const firstLine = fullMessage.split("\n")[0] ?? fullMessage;
  jobError.stack = `${jobError.name}: ${firstLine}\n${fullMessage}`;
}

interface JobErrorLike {
  readonly name: string;
  stack?: string;
}
