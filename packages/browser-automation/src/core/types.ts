/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JSONValue } from "./json";
import type { LocatorSpec } from "./locator";
import type { BrowserSessionState } from "./context";

// ========================================================================
// Extract Specification
// ========================================================================

export type ExtractKind =
  | "text"
  | "innerHTML"
  | "attribute"
  | "value"
  | "textContent"
  | "allText"
  | "table";

export interface ExtractSpec {
  kind: ExtractKind;
  locator?: LocatorSpec;
  attribute?: string;
}

// ========================================================================
// Wait Specification
// ========================================================================

export type WaitMode = "timeout" | "locator" | "url" | "loadState";

export interface WaitSpec {
  mode: WaitMode;
  locator?: LocatorSpec;
  state?: "visible" | "hidden" | "attached" | "detached";
  urlPattern?: string;
  loadState?: "load" | "domcontentloaded" | "networkidle";
}

// ========================================================================
// Screenshot Specification
// ========================================================================

export interface ScreenshotSpec {
  fullPage?: boolean;
  locator?: LocatorSpec;
  format?: "png" | "jpeg";
  quality?: number;
}

// ========================================================================
// Screenshot Output (serializable)
// ========================================================================

export interface ScreenshotOutput {
  mime: "image/png" | "image/jpeg";
  base64: string;
  width?: number;
  height?: number;
}

// ========================================================================
// Runtime Session Interface (not serializable - lives in manager only)
// ========================================================================

export interface IBrowserRuntimeSession {
  readonly backend: string;
  close(): Promise<void>;
  navigate(
    url: string,
    opts: { timeoutMs: number; waitUntil: string }
  ): Promise<{ url: string; title: string; status?: number; ok?: boolean }>;
  click(
    locator: LocatorSpec,
    opts: { timeoutMs: number; button?: "left" | "right" | "middle"; clickCount?: number }
  ): Promise<void>;
  type(
    locator: LocatorSpec,
    text: string,
    opts: { timeoutMs: number; clear?: boolean; delayMs?: number }
  ): Promise<void>;
  extract(spec: ExtractSpec, opts: { timeoutMs: number }): Promise<JSONValue>;
  wait(spec: WaitSpec, opts: { timeoutMs: number }): Promise<void>;
  screenshot(
    opts: ScreenshotSpec & { timeoutMs: number }
  ): Promise<{ mime: "image/png" | "image/jpeg"; bytes: Uint8Array }>;
  evaluate(script: string, opts: { timeoutMs: number }): Promise<JSONValue>;
}

// ========================================================================
// Backend Adapter Interface
// ========================================================================

export interface IBrowserBackendAdapter {
  createSession(session: BrowserSessionState): Promise<IBrowserRuntimeSession>;
}

// ========================================================================
// Unsafe Execution Policy
// ========================================================================

export interface UnsafeExecutionPolicy {
  allowPageEvaluateStrings: boolean;
  allowedScriptIds?: string[];
}
