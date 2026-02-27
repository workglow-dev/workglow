/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Structured logger interface for use across all workglow packages.
 * Implementations are swapped via DI ({@link LoggerRegistry}).
 */
export interface ILogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  fatal(err: Error, message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): ILogger;
  time(label: string, meta?: Record<string, unknown>): void;
  timeEnd(label: string, meta?: Record<string, unknown>): void;
  group(label: string, meta?: Record<string, unknown>): void;
  groupEnd(): void;
}
