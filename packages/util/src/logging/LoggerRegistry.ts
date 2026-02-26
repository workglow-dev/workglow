/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, globalServiceRegistry } from "../di/ServiceRegistry";
import { ConsoleLogger } from "./ConsoleLogger";
import type { ILogger } from "./ILogger";

/**
 * Service token for the global logger instance.
 */
export const LOGGER = createServiceToken<ILogger>("logger");

// Register default ConsoleLogger if nothing else has been registered yet.
if (!globalServiceRegistry.has(LOGGER)) {
  globalServiceRegistry.register(LOGGER, (): ILogger => new ConsoleLogger(), true);
}

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
