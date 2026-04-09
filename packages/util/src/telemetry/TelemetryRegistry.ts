/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, globalServiceRegistry } from "../di/ServiceRegistry";
import { ConsoleTelemetryProvider } from "./ConsoleTelemetryProvider";
import type { ITelemetryProvider } from "./ITelemetryProvider";
import { NoopTelemetryProvider } from "./NoopTelemetryProvider";

/**
 * Service token for the global telemetry provider instance.
 */
export const TELEMETRY_PROVIDER = createServiceToken<ITelemetryProvider>("telemetry");

function getEnv(name: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[name];
  }
  return import.meta.env[name];
}

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

function createDefaultTelemetryProvider(): ITelemetryProvider {
  if (getEnv("TELEMETRY")?.toLowerCase() === "console") {
    return new ConsoleTelemetryProvider();
  }
  if (
    isTruthy(getEnv("DEV")) &&
    getEnv("NODE_ENV") !== "test" &&
    !isTruthy(getEnv("VITEST")) &&
    !isTruthy(getEnv("CI"))
  ) {
    return new ConsoleTelemetryProvider();
  }
  return new NoopTelemetryProvider();
}

// Register the default provider based on environment configuration.
globalServiceRegistry.registerIfAbsent(TELEMETRY_PROVIDER, createDefaultTelemetryProvider, true);

/**
 * Returns the current global telemetry provider.
 */
export function getTelemetryProvider(): ITelemetryProvider {
  return globalServiceRegistry.get(TELEMETRY_PROVIDER);
}

/**
 * Replaces the global telemetry provider instance.
 *
 * @example
 * ```ts
 * import { OTelTelemetryProvider } from "@workglow/util";
 * import { trace } from "@opentelemetry/api";
 *
 * setTelemetryProvider(new OTelTelemetryProvider(trace.getTracer("my-app")));
 * ```
 */
export function setTelemetryProvider(provider: ITelemetryProvider): void {
  globalServiceRegistry.registerInstance(TELEMETRY_PROVIDER, provider);
}
