/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Read an environment value from Node `process.env` when defined, otherwise from
 * Vite/browser `import.meta.env`.
 *
 * In Vite dev, `process` is often polyfilled without `DEV`, so reading only
 * `process.env` misses `import.meta.env.DEV` and disables dev-only features
 * (e.g. console telemetry).
 *
 * Boolean `import.meta.env` flags become `"true"` or are treated as unset when false
 * so callers using simple truthiness behave as expected.
 */
export function readRuntimeEnv(name: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    const fromProcess = process.env[name];
    if (fromProcess !== undefined) {
      return fromProcess;
    }
  }

  const meta = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> })
    .env;
  if (!meta) {
    return undefined;
  }

  const value = meta[name];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value ? "true" : undefined;
  }
  return String(value);
}
