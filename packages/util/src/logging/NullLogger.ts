/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ILogger } from "./ILogger";

/**
 * Silent logger that discards all output.
 * Useful for suppressing log noise in tests.
 */
export class NullLogger implements ILogger {
  info(_message: string, _meta?: Record<string, unknown>): void {}
  error(_message: string, _meta?: Record<string, unknown>): void {}
  warn(_message: string, _meta?: Record<string, unknown>): void {}
  debug(_message: string, _meta?: Record<string, unknown>): void {}
  fatal(_err: Error, _message: string, _meta?: Record<string, unknown>): void {}
  time(_label: string, _meta?: Record<string, unknown>): void {}
  timeEnd(_label: string, _meta?: Record<string, unknown>): void {}
  group(_label: string, _meta?: Record<string, unknown>): void {}
  groupEnd(): void {}
  child(_bindings: Record<string, unknown>): ILogger {
    return this;
  }
}
