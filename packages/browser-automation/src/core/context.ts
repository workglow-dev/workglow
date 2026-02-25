/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JSONValue } from "./json";

// ========================================================================
// Browser Backend Names
// ========================================================================

export type BrowserBackendName = "playwright" | "electron" | "remote-playwright-cdp";

// ========================================================================
// Session Configuration (serializable)
// ========================================================================

export interface BrowserSessionConfig {
  headless?: boolean;
  viewport?: { width: number; height: number };
  userAgent?: string;
  timeoutMs?: number;

  persistence?:
    | { kind: "none" }
    | { kind: "playwrightUserDataDir"; userDataDir: string }
    | { kind: "electronPartition"; partition: string };

  playwright?: {
    browserType?: "chromium" | "firefox" | "webkit";
    launchOptions?: Record<string, JSONValue>;
    contextOptions?: Record<string, JSONValue>;
    storageState?: string | Record<string, JSONValue>;
  };

  remoteCdp?: {
    endpoint?: string;
    provider?: "browserless" | "brightdata" | "browserbase";
    apiKey?: string;
    region?: string;
    zone?: string;
  };
}

// ========================================================================
// Browser Session State (serializable, stored in context.__browser.session)
// ========================================================================

export interface BrowserSessionState {
  id: string;
  backend: BrowserBackendName;
  createdAt: string; // ISO timestamp
  config: BrowserSessionConfig;
}

// ========================================================================
// Browser Envelope (attached to workflow context as __browser)
// ========================================================================

export interface BrowserEnvelope {
  session: BrowserSessionState;
  last?: {
    url?: string;
    title?: string;
  };
}

// ========================================================================
// Workflow Context
// ========================================================================

export interface WorkflowContext {
  __browser?: BrowserEnvelope;
  [key: string]: unknown;
}

// ========================================================================
// Context Helper Functions
// ========================================================================

/**
 * Returns the browser envelope from context, or undefined if not present.
 */
export function getBrowserEnvelope(ctx: WorkflowContext): BrowserEnvelope | undefined {
  return ctx.__browser;
}

/**
 * Sets the browser envelope on context, returning a new context object.
 */
export function setBrowserEnvelope(ctx: WorkflowContext, env: BrowserEnvelope): WorkflowContext {
  return { ...ctx, __browser: env };
}

/**
 * Removes browser state from context.
 */
export function clearBrowserEnvelope(ctx: WorkflowContext): WorkflowContext {
  const { __browser: _, ...rest } = ctx;
  return rest;
}

/**
 * Updates the `last` metadata (url/title) on an existing envelope.
 */
export function setBrowserLast(
  ctx: WorkflowContext,
  last: { url?: string; title?: string },
  session: BrowserSessionState
): WorkflowContext {
  return setBrowserEnvelope(ctx, {
    session,
    last,
  });
}

/**
 * Resolves an existing session from context or creates a new session state
 * from the provided config override. If no config is provided and no session
 * exists, creates a default Playwright session.
 */
export function resolveOrCreateBrowserEnvelope(
  ctx: WorkflowContext,
  configOverride?: BrowserSessionConfig,
  backendOverride?: BrowserBackendName
): BrowserEnvelope {
  const existing = getBrowserEnvelope(ctx);
  if (existing) {
    return existing;
  }

  const config: BrowserSessionConfig = configOverride ?? { headless: true };
  const backend: BrowserBackendName = backendOverride ?? inferBackend(config);

  return {
    session: {
      id: generateSessionId(),
      backend,
      createdAt: new Date().toISOString(),
      config,
    },
  };
}

/**
 * Infers the backend from session config.
 */
function inferBackend(config: BrowserSessionConfig): BrowserBackendName {
  if (config.remoteCdp?.endpoint) {
    return "remote-playwright-cdp";
  }
  if (config.persistence?.kind === "electronPartition") {
    return "electron";
  }
  return "playwright";
}

/**
 * Generates a unique session ID.
 */
function generateSessionId(): string {
  return crypto.randomUUID();
}
