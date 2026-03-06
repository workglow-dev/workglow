/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, globalServiceRegistry } from "../di/ServiceRegistry";
import type { ITelemetryProvider } from "./ITelemetryProvider";
import { NoopTelemetryProvider } from "./NoopTelemetryProvider";

/**
 * Service token for the global telemetry provider instance.
 */
export const TELEMETRY_PROVIDER = createServiceToken<ITelemetryProvider>("telemetry");

// Register the default no-op provider so callers never get undefined.
if (!globalServiceRegistry.has(TELEMETRY_PROVIDER)) {
  globalServiceRegistry.register(TELEMETRY_PROVIDER, () => new NoopTelemetryProvider(), true);
}

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
