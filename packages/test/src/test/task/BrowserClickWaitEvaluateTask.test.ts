/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskConfigurationError } from "@workglow/task-graph";
import { BrowserClickTask, BrowserEvaluateTask, BrowserWaitTask } from "@workglow/tasks";
import { ServiceRegistry } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createBrowserTestState,
  createPatchedBrowserSessionManager,
  createTestRegistryWithManager,
} from "./browserTestRuntime";

describe("BrowserClick/Wait/Evaluate tasks", () => {
  let registry: ServiceRegistry;

  beforeEach(async () => {
    const state = createBrowserTestState();
    const manager = createPatchedBrowserSessionManager(state);
    await (manager as any).getOrCreateSession("session-1");
    registry = createTestRegistryWithManager(manager);
  });

  it("clicks, waits, and evaluates trusted JS", async () => {
    const clickTask = new BrowserClickTask();
    const clickResult = await clickTask.runner.run(
      {
        session_id: "session-1",
        selector: "#go",
      },
      { registry }
    );
    expect(clickResult.clicked).toBe(true);

    const waitTask = new BrowserWaitTask();
    const waitResult = await waitTask.runner.run(
      {
        session_id: "session-1",
        mode: "timeout",
        timeout_ms: 5,
      },
      { registry }
    );
    expect(waitResult.waited).toBe(true);

    const evaluateTask = new BrowserEvaluateTask();
    const evaluateResult = await evaluateTask.runner.run(
      {
        session_id: "session-1",
        args: { x: 21 },
        evaluate_code: "return args.x * 2;",
      },
      { registry }
    );
    expect(evaluateResult.result).toBe(42);
  });

  it("fails when no session id is provided for session-bound tasks", async () => {
    const clickTask = new BrowserClickTask();
    await expect(
      clickTask.runner.run(
        {
          selector: "#go",
        } as any,
        { registry }
      )
    ).rejects.toBeInstanceOf(TaskConfigurationError);
  });
});

