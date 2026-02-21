/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserNavigateTask } from "@workglow/tasks";
import { ServiceRegistry } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createBrowserTestState,
  createPatchedBrowserSessionManager,
  createTestRegistryWithManager,
} from "./browserTestRuntime";

describe("BrowserNavigateTask", () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    const state = createBrowserTestState();
    const manager = createPatchedBrowserSessionManager(state);
    registry = createTestRegistryWithManager(manager);
  });

  it("creates a session, navigates, and writes context.__browser metadata", async () => {
    const task = new BrowserNavigateTask();
    const result = await task.runner.run(
      {
        url: "https://example.com",
      },
      { registry }
    );

    expect(result.url).toBe("https://example.com");
    expect(result.title).toBe("Title:https://example.com");
    expect(result.context.__browser).toBeDefined();
    expect((result.context.__browser as any).session_id).toBeTypeOf("string");
    expect((result.context.__browser as any).url).toBe("https://example.com");
    expect((result.context.__browser as any).title).toBe("Title:https://example.com");
  });
});

