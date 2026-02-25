/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core types and schemas only — no heavy runtime dependencies (Playwright/Electron).
 * Import from "@workglow/browser-automation/core" when you only need type definitions.
 */

// JSON value types
export type { JSONPrimitive, JSONValue } from "./core/json";
export { assertJsonValue } from "./core/json";

// Context and session types
export type {
  BrowserBackendName,
  BrowserSessionConfig,
  BrowserSessionState,
  BrowserEnvelope,
  WorkflowContext,
} from "./core/context";
export {
  getBrowserEnvelope,
  setBrowserEnvelope,
  clearBrowserEnvelope,
  setBrowserLast,
  resolveOrCreateBrowserEnvelope,
  sanitizeBrowserSessionConfig,
} from "./core/context";

// Locator types
export type { LocatorSpec } from "./core/locator";
export { locatorSpecSchema } from "./core/locator";

// Runtime session and adapter interfaces
export type {
  ExtractKind,
  ExtractSpec,
  WaitMode,
  WaitSpec,
  ScreenshotSpec,
  ScreenshotOutput,
  IBrowserRuntimeSession,
  IBrowserBackendAdapter,
  UnsafeExecutionPolicy,
} from "./core/types";

// Service tokens
export { BROWSER_SESSION_MANAGER, RUN_CLEANUP_REGISTRY, UNSAFE_EXEC_POLICY } from "./core/tokens";

// Session management
export { RunCleanupRegistry } from "./session/RunCleanupRegistry";
export type { RunCleanupHandler } from "./session/RunCleanupRegistry";
export { FifoMutex } from "./session/FifoMutex";
export { BrowserSessionManager } from "./session/BrowserSessionManager";
export type { BrowserSessionManagerOpts } from "./session/BrowserSessionManager";
