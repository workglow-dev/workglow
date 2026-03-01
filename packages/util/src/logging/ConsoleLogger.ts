/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ILogger } from "./ILogger";

/**
 * Log-level names in ascending severity order.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

export interface ConsoleLoggerOptions {
  readonly bindings?: Record<string, unknown>;
  readonly level?: LogLevel;
  readonly timings?: boolean;
}

/**
 * Logger that delegates to the global `console` object.
 * When created via {@link child}, accumulated bindings are passed
 * as a second argument to every console call.
 *
 * Supports optional level filtering (messages below the configured
 * level are silently discarded) and an opt-in `timings` flag that
 * controls whether {@link time}/{@link timeEnd} produce output.
 */
export class ConsoleLogger implements ILogger {
  private readonly bindings: Record<string, unknown>;
  private readonly level: LogLevel;
  private readonly timings: boolean;

  constructor(options: ConsoleLoggerOptions = {}) {
    this.bindings = options.bindings ?? {};
    this.level = options.level ?? "debug";
    this.timings = options.timings ?? false;
  }

  private enabled(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.level];
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (!this.enabled("info")) return;
    const merged = this.merge(meta);
    if (merged) {
      console.info(message, merged);
    } else {
      console.info(message);
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (!this.enabled("warn")) return;
    const merged = this.merge(meta);
    if (merged) {
      console.warn(message, merged);
    } else {
      console.warn(message);
    }
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (!this.enabled("error")) return;
    const merged = this.merge(meta);
    if (merged) {
      console.error(message, merged);
    } else {
      console.error(message);
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (!this.enabled("debug")) return;
    const merged = this.merge(meta);
    if (merged) {
      console.debug(message, merged);
    } else {
      console.debug(message);
    }
  }

  fatal(err: Error, message: string, meta?: Record<string, unknown>): void {
    if (!this.enabled("fatal")) return;
    const merged = this.merge(meta);
    if (merged) {
      console.error(message, { ...merged, error: err });
    } else {
      console.error(message, { error: err });
    }
  }

  time(label: string, meta?: Record<string, unknown>): void {
    if (!this.timings) return;
    const merged = this.merge(meta);
    if (merged) {
      console.info(`[time] ${label}`, merged);
    }
    console.time(label);
  }

  timeEnd(label: string, meta?: Record<string, unknown>): void {
    if (!this.timings) return;
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
    return new ConsoleLogger({
      bindings: { ...this.bindings, ...bindings },
      level: this.level,
      timings: this.timings,
    });
  }

  private merge(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    const hasBindings = Object.keys(this.bindings).length > 0;
    if (!hasBindings && !meta) return undefined;
    if (!hasBindings) return meta;
    if (!meta) return this.bindings;
    return { ...this.bindings, ...meta };
  }
}
