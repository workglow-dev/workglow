/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  IExecuteContext,
  RUN_CLEANUP_REGISTRY,
  TaskConfigurationError,
} from "@workglow/task-graph";
import { createServiceToken, ServiceRegistry, uuid4 } from "@workglow/util";
import { BrowserTypeName, loadPlaywright } from "./loadPlaywright";

export interface BrowserSession {
  readonly sessionId: string;
  readonly browser: any;
  readonly context: any;
  readonly page: any;
}

export interface BrowserSessionOptions {
  browser_type?: BrowserTypeName;
  headless?: boolean;
  launch_options?: Record<string, unknown>;
  context_options?: Record<string, unknown>;
}

class SessionMutex {
  private tail: Promise<void> = Promise.resolve();

  public async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return await run;
  }
}

export class BrowserSessionManager {
  public readonly managerId = uuid4();
  private sessions = new Map<string, BrowserSession>();
  private sessionLocks = new Map<string, SessionMutex>();

  public async runExclusive<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    let lock = this.sessionLocks.get(sessionId);
    if (!lock) {
      lock = new SessionMutex();
      this.sessionLocks.set(sessionId, lock);
    }
    return await lock.runExclusive(fn);
  }

  public async getOrCreateSession(
    sessionId: string,
    options: BrowserSessionOptions = {}
  ): Promise<BrowserSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const playwright = await loadPlaywright();
    const browserType = options.browser_type ?? "chromium";
    const launcher = playwright[browserType] ?? playwright.chromium;
    if (!launcher) {
      throw new TaskConfigurationError(`Unsupported browser type: ${browserType}`);
    }

    const browser = await launcher.launch({
      headless: options.headless ?? true,
      ...(options.launch_options ?? {}),
    });
    const context = await browser.newContext(options.context_options ?? {});
    const page = await context.newPage();

    const session: BrowserSession = { sessionId, browser, context, page };
    this.sessions.set(sessionId, session);
    return session;
  }

  public getSessionOrThrow(sessionId: string): BrowserSession {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      throw new TaskConfigurationError(
        `Browser session '${sessionId}' not found. Start with BrowserNavigateTask first.`
      );
    }
    return existing;
  }

  public async closeSession(sessionId: string): Promise<boolean> {
    const existing = this.sessions.get(sessionId);
    if (!existing) return false;

    this.sessions.delete(sessionId);
    this.sessionLocks.delete(sessionId);
    await Promise.allSettled([existing.page?.close?.(), existing.context?.close?.(), existing.browser?.close?.()]);
    return true;
  }

  public async closeAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    await Promise.allSettled(ids.map(async (id) => await this.closeSession(id)));
  }
}

export const BROWSER_SESSION_MANAGER = createServiceToken<BrowserSessionManager>(
  "tasks.browserSessionManager"
);

export function getBrowserSessionManager(registry: ServiceRegistry): BrowserSessionManager {
  let manager: BrowserSessionManager;
  if (registry.has(BROWSER_SESSION_MANAGER)) {
    manager = registry.get(BROWSER_SESSION_MANAGER);
  } else {
    manager = new BrowserSessionManager();
    registry.registerInstance(BROWSER_SESSION_MANAGER, manager);
  }

  if (registry.has(RUN_CLEANUP_REGISTRY)) {
    const runCleanup = registry.get(RUN_CLEANUP_REGISTRY);
    runCleanup.add(`tasks.browserSessionManager.${manager.managerId}`, async () => {
      await manager.closeAll();
    });
  }

  return manager;
}

export function getBrowserSessionManagerFromContext(context: IExecuteContext): BrowserSessionManager {
  return getBrowserSessionManager(context.registry);
}
