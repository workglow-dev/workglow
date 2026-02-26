/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Logger } from "tslog";
import { setLogger } from "@workglow/util";
import type { ILogger } from "@workglow/util";

/**
 * {@link ILogger} adapter backed by tslog.
 * Registered as the global logger when the `workglow` meta-package is imported.
 */
export class TsLogLogger implements ILogger {
  private readonly logger: Logger<unknown>;

  constructor(logger?: Logger<unknown>) {
    this.logger = logger ?? new Logger({ name: "workglow" });
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (meta) {
      this.logger.info(message, meta);
    } else {
      this.logger.info(message);
    }
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (meta) {
      this.logger.error(message, meta);
    } else {
      this.logger.error(message);
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (meta) {
      this.logger.debug(message, meta);
    } else {
      this.logger.debug(message);
    }
  }

  fatal(err: Error, message: string, meta?: Record<string, unknown>): void {
    if (meta) {
      this.logger.fatal(message, err, meta);
    } else {
      this.logger.fatal(message, err);
    }
  }

  child(bindings: Record<string, unknown>): ILogger {
    return new TsLogLogger(this.logger.getSubLogger({}, bindings));
  }
}

// Override the default ConsoleLogger with tslog.
setLogger(new TsLogLogger());
