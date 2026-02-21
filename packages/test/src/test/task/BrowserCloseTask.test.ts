/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserCloseTask } from "@workglow/tasks";
import { ServiceRegistry } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createBrowserTestState,
  createPatchedBrowserSessionManager,
  createTestRegistryWithManager,
} from "./browserTestRuntime";

describe("BrowserCloseTask", () => {
  let registry: ServiceRegistry;
  let state = createBrowserTestState();

  beforeEach(async () => {
    state = createBrowserTestState();
    const manager = createPatchedBrowserSessionManager(state);
    await (manager as any).getOrCreateSession("session-close");
    registry = createTestRegistryWithManager(manager);
  });

  it("closes a session and clears context metadata", async () => {
    const task = new BrowserCloseTask();
    const result = await task.runner.run(
      {
        context: {
          __browser: {
            session_id: "session-close",
            url: "https://example.com",
          },
        },
      },
      { registry }
    );

    expect(result.closed).toBe(true);
    expect(result.context.__browser).toBeUndefined();
    expect(state.closedSessions).toContain("session-close");
  });

  it("is idempotent when session is already closed", async () => {
    const task = new BrowserCloseTask();
    await task.runner.run(
      {
        session_id: "session-close",
      },
      { registry }
    );

    const second = await task.runner.run(
      {
        session_id: "session-close",
      },
      { registry }
    );

    expect(second.closed).toBe(true);
    expect(state.closedSessions.filter((id) => id === "session-close").length).toBe(2);
  });

});
