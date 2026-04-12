/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test, beforeEach, vi } from "vitest";
import {
  BrowserSessionTask,
  BrowserSessionRegistry,
  BrowserNavigateTask,
  BrowserBackTask,
  BrowserForwardTask,
  BrowserReloadTask,
  registerBrowserDeps,
} from "@workglow/tasks";
import { MockBrowserContext } from "./MockBrowserContext";

describe("BrowserNavigateTask", () => {
  let sessionId: string;
  let mockCtx: MockBrowserContext;

  beforeEach(async () => {
    BrowserSessionRegistry.clear();
    mockCtx = new MockBrowserContext();
    registerBrowserDeps({
      createContext: () => mockCtx,
      availableBackends: ["local"],
      defaultBackend: "local",
      profileStorage: {
        save: vi.fn(),
        load: vi.fn().mockResolvedValue(null),
        delete: vi.fn(),
      },
    });
    const sessionTask = new BrowserSessionTask({ headless: true });
    const result = await sessionTask.run({});
    sessionId = result.sessionId;
  });

  test("navigates to a URL and returns title and url", async () => {
    const task = new BrowserNavigateTask({ waitUntil: "load" });
    const result = await task.run({ sessionId, url: "https://example.com" });
    expect(result.sessionId).toBe(sessionId);
    expect(typeof result.title).toBe("string");
    expect(typeof result.url).toBe("string");
    const navigateCall = mockCtx.calls.find((c) => c.method === "navigate");
    expect(navigateCall).toBeDefined();
    expect(navigateCall!.args[0]).toBe("https://example.com");
    expect((navigateCall!.args[1] as { waitUntil: string }).waitUntil).toBe("load");
  });

  test("navigate uses default waitUntil of load when not specified", async () => {
    const task = new BrowserNavigateTask();
    await task.run({ sessionId, url: "https://example.com/page" });
    const navigateCall = mockCtx.calls.find((c) => c.method === "navigate");
    expect(navigateCall).toBeDefined();
    expect((navigateCall!.args[1] as { waitUntil: string }).waitUntil).toBe("load");
  });
});

describe("BrowserBackTask", () => {
  let sessionId: string;
  let mockCtx: MockBrowserContext;

  beforeEach(async () => {
    BrowserSessionRegistry.clear();
    mockCtx = new MockBrowserContext();
    registerBrowserDeps({
      createContext: () => mockCtx,
      availableBackends: ["local"],
      defaultBackend: "local",
      profileStorage: {
        save: vi.fn(),
        load: vi.fn().mockResolvedValue(null),
        delete: vi.fn(),
      },
    });
    const sessionTask = new BrowserSessionTask({ headless: true });
    const result = await sessionTask.run({});
    sessionId = result.sessionId;
  });

  test("calls goBack and returns sessionId and url", async () => {
    const task = new BrowserBackTask();
    const result = await task.run({ sessionId });
    expect(result.sessionId).toBe(sessionId);
    expect(typeof result.url).toBe("string");
    const goBackCall = mockCtx.calls.find((c) => c.method === "goBack");
    expect(goBackCall).toBeDefined();
  });
});

describe("BrowserForwardTask", () => {
  let sessionId: string;
  let mockCtx: MockBrowserContext;

  beforeEach(async () => {
    BrowserSessionRegistry.clear();
    mockCtx = new MockBrowserContext();
    registerBrowserDeps({
      createContext: () => mockCtx,
      availableBackends: ["local"],
      defaultBackend: "local",
      profileStorage: {
        save: vi.fn(),
        load: vi.fn().mockResolvedValue(null),
        delete: vi.fn(),
      },
    });
    const sessionTask = new BrowserSessionTask({ headless: true });
    const result = await sessionTask.run({});
    sessionId = result.sessionId;
  });

  test("calls goForward and returns sessionId and url", async () => {
    const task = new BrowserForwardTask();
    const result = await task.run({ sessionId });
    expect(result.sessionId).toBe(sessionId);
    expect(typeof result.url).toBe("string");
    const goForwardCall = mockCtx.calls.find((c) => c.method === "goForward");
    expect(goForwardCall).toBeDefined();
  });
});

describe("BrowserReloadTask", () => {
  let sessionId: string;
  let mockCtx: MockBrowserContext;

  beforeEach(async () => {
    BrowserSessionRegistry.clear();
    mockCtx = new MockBrowserContext();
    registerBrowserDeps({
      createContext: () => mockCtx,
      availableBackends: ["local"],
      defaultBackend: "local",
      profileStorage: {
        save: vi.fn(),
        load: vi.fn().mockResolvedValue(null),
        delete: vi.fn(),
      },
    });
    const sessionTask = new BrowserSessionTask({ headless: true });
    const result = await sessionTask.run({});
    sessionId = result.sessionId;
  });

  test("calls reload and returns sessionId", async () => {
    const task = new BrowserReloadTask();
    const result = await task.run({ sessionId });
    expect(result.sessionId).toBe(sessionId);
    const reloadCall = mockCtx.calls.find((c) => c.method === "reload");
    expect(reloadCall).toBeDefined();
  });
});
