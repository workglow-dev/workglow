/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test, beforeEach, vi } from "vitest";
import { BrowserSessionTask, BrowserCloseTask, BrowserSessionRegistry, registerBrowserDeps } from "@workglow/tasks";
import { MockBrowserContext } from "./MockBrowserContext";

describe("BrowserSessionTask", () => {
  beforeEach(() => {
    BrowserSessionRegistry.clear();
    registerBrowserDeps({
      createContext: () => new MockBrowserContext(),
      availableBackends: ["local"],
      defaultBackend: "local",
      profileStorage: {
        save: vi.fn(),
        load: vi.fn().mockResolvedValue(null),
        delete: vi.fn(),
      },
    });
  });

  test("creates a session and returns sessionId", async () => {
    const task = new BrowserSessionTask({ headless: true });
    const result = await task.run({});
    expect(typeof result.sessionId).toBe("string");
    expect(result.sessionId.length).toBeGreaterThan(0);
    const ctx = BrowserSessionRegistry.get(result.sessionId);
    expect(ctx.isConnected()).toBe(true);
  });

  test("BrowserCloseTask closes the session", async () => {
    const task = new BrowserSessionTask({ headless: true });
    const { sessionId } = await task.run({});
    const closeTask = new BrowserCloseTask();
    await closeTask.run({ sessionId });
    expect(() => BrowserSessionRegistry.get(sessionId)).toThrow();
  });
});
