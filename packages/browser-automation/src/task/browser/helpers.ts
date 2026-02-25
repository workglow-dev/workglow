/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskConfigurationError } from "@workglow/task-graph";
import type { ServiceRegistry } from "@workglow/util";
import type {
  WorkflowContext,
  BrowserEnvelope,
  BrowserSessionConfig,
  BrowserBackendName,
} from "../../core/context";
import {
  resolveOrCreateBrowserEnvelope,
  sanitizeBrowserSessionConfig,
  setBrowserLast,
  clearBrowserEnvelope,
} from "../../core/context";
import { BROWSER_SESSION_MANAGER, RUN_CLEANUP_REGISTRY } from "../../core/tokens";
import { BrowserSessionManager } from "../../session/BrowserSessionManager";
import { RunCleanupRegistry } from "../../session/RunCleanupRegistry";
import { PlaywrightAdapter } from "../../backend/playwright/PlaywrightAdapter";

/**
 * Normalize the context input to a WorkflowContext.
 */
export function normalizeContext(ctx: unknown): WorkflowContext {
  if (ctx == null || typeof ctx !== "object") return {};
  return ctx as WorkflowContext;
}

/**
 * Get or lazily create the BrowserSessionManager from the service registry.
 * Creates a default Playwright-backed manager if none is registered.
 */
export function getBrowserSessionManager(registry: ServiceRegistry): BrowserSessionManager {
  if (registry.has(BROWSER_SESSION_MANAGER)) {
    return registry.get(BROWSER_SESSION_MANAGER);
  }

  // Lazily create a default manager with Playwright adapter
  let cleanup: RunCleanupRegistry;
  if (registry.has(RUN_CLEANUP_REGISTRY)) {
    cleanup = registry.get(RUN_CLEANUP_REGISTRY);
  } else {
    cleanup = new RunCleanupRegistry();
    registry.registerInstance(RUN_CLEANUP_REGISTRY, cleanup);
  }

  const manager = new BrowserSessionManager(
    {
      playwright: new PlaywrightAdapter(),
    },
    cleanup
  );
  registry.registerInstance(BROWSER_SESSION_MANAGER, manager);
  return manager;
}

/**
 * Standard browser task input processing:
 * - Normalize context
 * - Resolve or create browser envelope
 * - Ensure runtime session exists
 * Returns { context, envelope } for use in the task body.
 */
export async function prepareBrowserSession(
  inputContext: unknown,
  inputSession: BrowserSessionConfig | undefined,
  inputBackend: BrowserBackendName | undefined,
  registry: ServiceRegistry
): Promise<{
  context: WorkflowContext;
  envelope: BrowserEnvelope;
  manager: BrowserSessionManager;
}> {
  const context = normalizeContext(inputContext);
  const envelope = resolveOrCreateBrowserEnvelope(context, inputSession, inputBackend);
  const manager = getBrowserSessionManager(registry);
  await manager.getOrCreate(envelope.session); // full config with secrets needed here

  // Strip secrets before the envelope is embedded into context via task outputs
  const safeEnvelope: BrowserEnvelope = {
    ...envelope,
    session: {
      ...envelope.session,
      config: sanitizeBrowserSessionConfig(envelope.session.config),
    },
  };
  return { context, envelope: safeEnvelope, manager };
}

export { resolveOrCreateBrowserEnvelope, setBrowserLast, clearBrowserEnvelope };
