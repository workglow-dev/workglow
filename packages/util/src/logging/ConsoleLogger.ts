/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ILogger } from "./ILogger";

/**
 * Default logger that delegates to the global `console` object.
 * When created via {@link child}, accumulated bindings are passed
 * as a second argument to every console call.
 */
export class ConsoleLogger implements ILogger {
  private readonly bindings: Record<string, unknown>;

  constructor(bindings: Record<string, unknown> = {}) {
    this.bindings = bindings;
  }

  info(message: string, meta?: Record<string, unknown>): void {
    const merged = this.merge(meta);
    if (merged) {
      console.info(message, merged);
    } else {
      console.info(message);
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    const merged = this.merge(meta);
    if (merged) {
      console.warn(message, merged);
    } else {
      console.warn(message);
    }
  }

  error(message: string, meta?: Record<string, unknown>): void {
    const merged = this.merge(meta);
    if (merged) {
      console.error(message, merged);
    } else {
      console.error(message);
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    const merged = this.merge(meta);
    if (merged) {
      console.debug(message, merged);
    } else {
      console.debug(message);
    }
  }

  fatal(err: Error, message: string, meta?: Record<string, unknown>): void {
    const merged = this.merge(meta);
    if (merged) {
      console.error(message, { ...merged, error: err });
    } else {
      console.error(message, { error: err });
    }
  }

  time(label: string, meta?: Record<string, unknown>): void {
    const merged = this.merge(meta);
    if (merged) {
      console.info(`[time] ${label}`, merged);
    }
    console.time(label);
  }

  timeEnd(label: string, meta?: Record<string, unknown>): void {
    console.timeEnd(label);
    const merged = this.merge(meta);
    if (merged) {
      console.info(`[timeEnd] ${label}`, merged);
    }
  }

  group(label: string, meta?: Record<string, unknown>): void {
    const merged = this.merge(meta);
    if (merged) {
      console.group(label, merged);
    } else {
      console.group(label);
    }
  }

  groupEnd(): void {
    console.groupEnd();
  }

  child(bindings: Record<string, unknown>): ILogger {
    return new ConsoleLogger({ ...this.bindings, ...bindings });
  }

  private merge(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    const hasBindings = Object.keys(this.bindings).length > 0;
    if (!hasBindings && !meta) return undefined;
    if (!hasBindings) return meta;
    if (!meta) return this.bindings;
    return { ...this.bindings, ...meta };
  }
}
