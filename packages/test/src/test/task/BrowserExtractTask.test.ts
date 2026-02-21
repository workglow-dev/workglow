/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserExtractTask } from "@workglow/tasks";
import { ServiceRegistry } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createBrowserTestState,
  createPatchedBrowserSessionManager,
  createTestRegistryWithManager,
} from "./browserTestRuntime";

describe("BrowserExtractTask", () => {
  let registry: ServiceRegistry;

  beforeEach(async () => {
    const state = createBrowserTestState();
    const manager = createPatchedBrowserSessionManager(state);
    await (manager as any).getOrCreateSession("session-1");
    registry = createTestRegistryWithManager(manager);
  });

  it("extracts text content", async () => {
    const task = new BrowserExtractTask();
    const result = await task.runner.run(
      {
        session_id: "session-1",
        selector: "#title",
        kind: "text",
      },
      { registry }
    );

    expect(result.data).toBe("Example Title");
    expect((result.context.__browser as any).session_id).toBe("session-1");
  });

  it("extracts list attributes", async () => {
    const task = new BrowserExtractTask();
    const result = await task.runner.run(
      {
        session_id: "session-1",
        selector: ".items",
        kind: "list",
        list_kind: "attr",
        attr_name: "data-id",
      },
      { registry }
    );

    expect(result.data).toEqual(["1", "2"]);
  });
});
