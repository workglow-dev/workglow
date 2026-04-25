/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, globalServiceRegistry } from "../di/ServiceRegistry";
import { readRuntimeEnv } from "../utilities/runtimeEnv";
import type { LogLevel } from "./ConsoleLogger";
import { ConsoleLogger } from "./ConsoleLogger";
import type { ILogger } from "./ILogger";
import { NullLogger } from "./NullLogger";

/**
 * Service token for the global logger instance.
 */
export const LOGGER = createServiceToken<ILogger>("logger");

const VALID_LOG_LEVELS: ReadonlySet<string> = new Set<string>([
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]);

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

function createDefaultLogger(): ILogger {
  const levelEnv = readRuntimeEnv("LOGGER_LEVEL")?.toLowerCase();
  if (levelEnv && VALID_LOG_LEVELS.has(levelEnv)) {
    return new ConsoleLogger({
      level: levelEnv as LogLevel,
      timings: isTruthy(readRuntimeEnv("LOGGER_TIMINGS")),
    });
  }
  if (isTruthy(readRuntimeEnv("DEV"))) {
    return new ConsoleLogger({
      level: "debug" as LogLevel,
      timings: true,
    });
  }
  return new NullLogger();
}

// Register default logger: NullLogger unless LOGGER_LEVEL env var is set.
globalServiceRegistry.registerIfAbsent(LOGGER, createDefaultLogger, true);

/**
 * Returns the current global logger.
 */
export function getLogger(): ILogger {
  return globalServiceRegistry.get(LOGGER);
}

/**
 * Replaces the global logger instance.
 */
export function setLogger(logger: ILogger): void {
  globalServiceRegistry.registerInstance(LOGGER, logger);
}
