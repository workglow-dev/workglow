/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test, beforeEach, vi } from "vitest";
import {
  BrowserSessionTask,
  BrowserSessionRegistry,
  BrowserClickTask,
  BrowserFillTask,
  registerBrowserDeps,
} from "@workglow/tasks";
import { MockBrowserContext } from "./MockBrowserContext";

describe("BrowserClickTask", () => {
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

  test("clicks by ref", async () => {
    const task = new BrowserClickTask();
    const result = await task.run({ sessionId, ref: "e4" });
    expect(result.sessionId).toBe(sessionId);
    const clickCall = mockCtx.calls.find((c) => c.method === "click");
    expect(clickCall).toBeDefined();
    expect(clickCall!.args[0]).toBe("e4");
  });

  test("clicks by role and name", async () => {
    const task = new BrowserClickTask();
    const result = await task.run({ sessionId, role: "button", name: "Sign in" });
    expect(result.sessionId).toBe(sessionId);
    const clickByRoleCall = mockCtx.calls.find((c) => c.method === "clickByRole");
    expect(clickByRoleCall).toBeDefined();
    expect(clickByRoleCall!.args[0]).toBe("button");
    expect(clickByRoleCall!.args[1]).toBe("Sign in");
  });

  test("throws when neither ref nor role+name is provided", async () => {
    const task = new BrowserClickTask();
    await expect(task.run({ sessionId })).rejects.toThrow(
      "BrowserClickTask: either ref or role+name must be provided"
    );
  });
});

describe("BrowserFillTask", () => {
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

  test("fills by ref", async () => {
    const task = new BrowserFillTask();
    const result = await task.run({ sessionId, ref: "e2", value: "test@example.com" });
    expect(result.sessionId).toBe(sessionId);
    const fillCall = mockCtx.calls.find((c) => c.method === "fill");
    expect(fillCall).toBeDefined();
    expect(fillCall!.args[0]).toBe("e2");
    expect(fillCall!.args[1]).toBe("test@example.com");
  });

  test("fills by label", async () => {
    const task = new BrowserFillTask();
    const result = await task.run({ sessionId, label: "Email address", value: "test@example.com" });
    expect(result.sessionId).toBe(sessionId);
    const fillByLabelCall = mockCtx.calls.find((c) => c.method === "fillByLabel");
    expect(fillByLabelCall).toBeDefined();
    expect(fillByLabelCall!.args[0]).toBe("Email address");
    expect(fillByLabelCall!.args[1]).toBe("test@example.com");
  });

  test("throws when neither ref nor label is provided", async () => {
    const task = new BrowserFillTask();
    await expect(task.run({ sessionId, value: "test" })).rejects.toThrow(
      "BrowserFillTask: either ref or label must be provided"
    );
  });
});
