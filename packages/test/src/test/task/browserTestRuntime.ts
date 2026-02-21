/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskConfigurationError } from "@workglow/task-graph";
import { BROWSER_SESSION_MANAGER, BrowserSessionManager } from "@workglow/tasks";
import { ServiceRegistry } from "@workglow/util";

type BrowserElement = {
  text?: string;
  html?: string;
  attributes?: Record<string, string>;
  properties?: Record<string, unknown>;
};

export type BrowserTestState = {
  sessionUrls: Record<string, string>;
  sessionTitles: Record<string, string>;
  selectors: Record<string, BrowserElement[]>;
  clickSelectors: string[];
  waitEvents: string[];
  evaluatePayloads: unknown[];
  closedSessions: string[];
  maxConcurrentClicks: number;
  inFlightClicks: number;
};

export function createBrowserTestState(): BrowserTestState {
  return {
    sessionUrls: {},
    sessionTitles: {},
    selectors: {
      "#title": [{ text: "Example Title", html: "<h1>Example Title</h1>" }],
      "#go": [{ text: "Go", html: "<button>Go</button>" }],
      ".items": [
        { text: "alpha", html: "<li>alpha</li>", attributes: { "data-id": "1" } },
        { text: "beta", html: "<li>beta</li>", attributes: { "data-id": "2" } },
      ],
    },
    clickSelectors: [],
    waitEvents: [],
    evaluatePayloads: [],
    closedSessions: [],
    maxConcurrentClicks: 0,
    inFlightClicks: 0,
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function createElementObject(el: BrowserElement): any {
  const attrs = el.attributes ?? {};
  const props = el.properties ?? {};
  return {
    innerHTML: el.html ?? "",
    textContent: el.text ?? "",
    getAttribute(name: string) {
      return attrs[name] ?? null;
    },
    ...props,
  };
}

function createLocator(state: BrowserTestState, selector: string) {
  const entries = state.selectors[selector] ?? [];

  return {
    first() {
      const first = entries[0] ?? {};
      return {
        async textContent() {
          return first.text ?? null;
        },
        async innerHTML() {
          return first.html ?? "";
        },
        async getAttribute(name: string) {
          return first.attributes?.[name] ?? null;
        },
        async evaluate(fn: (el: any, arg: any) => unknown, arg: unknown) {
          return fn(createElementObject(first), arg);
        },
      };
    },
    async count() {
      return entries.length;
    },
    async allTextContents() {
      return entries.map((entry) => entry.text ?? "");
    },
    async evaluateAll(fn: (els: any[], arg?: any) => unknown, arg?: unknown) {
      return fn(entries.map(createElementObject), arg);
    },
  };
}

function createPage(state: BrowserTestState, sessionId: string) {
  state.sessionUrls[sessionId] = state.sessionUrls[sessionId] ?? "about:blank";
  state.sessionTitles[sessionId] = state.sessionTitles[sessionId] ?? "Untitled";

  return {
    async goto(url: string) {
      state.sessionUrls[sessionId] = url;
      state.sessionTitles[sessionId] = `Title:${url}`;
      return {
        status: () => 200,
        ok: () => true,
      };
    },
    url() {
      return state.sessionUrls[sessionId];
    },
    async title() {
      return state.sessionTitles[sessionId];
    },
    async click(selector: string, options?: { delay?: number }) {
      state.inFlightClicks += 1;
      state.maxConcurrentClicks = Math.max(state.maxConcurrentClicks, state.inFlightClicks);
      try {
        if (options?.delay) {
          await sleep(options.delay);
        }
        state.clickSelectors.push(selector);
      } finally {
        state.inFlightClicks -= 1;
      }
    },
    async waitForNavigation() {
      state.waitEvents.push("navigation");
    },
    async waitForTimeout(ms: number) {
      state.waitEvents.push(`timeout:${ms}`);
      await sleep(Math.min(ms, 5));
    },
    async waitForSelector(selector: string) {
      state.waitEvents.push(`selector:${selector}`);
    },
    async waitForURL(url: string) {
      state.waitEvents.push(`url:${url}`);
      state.sessionUrls[sessionId] = url;
    },
    async waitForLoadState(loadState: string) {
      state.waitEvents.push(`load:${loadState}`);
    },
    async waitForFunction(fn: (arg: any) => unknown, arg: any) {
      state.waitEvents.push("function");
      const value = fn(arg);
      if (!value) {
        throw new TaskConfigurationError("waitForFunction predicate returned false");
      }
    },
    locator(selector: string) {
      return createLocator(state, selector);
    },
    async evaluate(fn: (arg: any) => unknown, arg: any) {
      state.evaluatePayloads.push(arg);
      return await fn(arg);
    },
    async close() {},
  };
}

export function createPatchedBrowserSessionManager(state: BrowserTestState): BrowserSessionManager {
  const manager = new BrowserSessionManager();
  const sessions = new Map<string, any>();

  const getSession = (sessionId: string) => {
    let existing = sessions.get(sessionId);
    if (!existing) {
      const page = createPage(state, sessionId);
      existing = {
        sessionId,
        page,
        context: {
          async close() {},
          async newPage() {
            return page;
          },
        },
        browser: {
          async close() {},
        },
      };
      sessions.set(sessionId, existing);
    }
    return existing;
  };

  (manager as any).getOrCreateSession = async (sessionId: string) => getSession(sessionId);
  (manager as any).getSessionOrThrow = (sessionId: string) => {
    const existing = sessions.get(sessionId);
    if (!existing) {
      throw new TaskConfigurationError(`Browser session '${sessionId}' not found`);
    }
    return existing;
  };
  (manager as any).closeSession = async (sessionId: string) => {
    const exists = sessions.has(sessionId);
    sessions.delete(sessionId);
    state.closedSessions.push(sessionId);
    return exists;
  };
  (manager as any).closeAll = async () => {
    for (const sessionId of Array.from(sessions.keys())) {
      sessions.delete(sessionId);
      state.closedSessions.push(sessionId);
    }
  };

  return manager;
}

export function createTestRegistryWithManager(manager: BrowserSessionManager): ServiceRegistry {
  const registry = new ServiceRegistry();
  registry.registerInstance(BROWSER_SESSION_MANAGER, manager);
  return registry;
}
