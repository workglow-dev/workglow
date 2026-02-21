/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskStatus, Workflow } from "@workglow/task-graph";
import {
  BROWSER_SESSION_MANAGER,
  BrowserClickTask,
  BrowserCloseTask,
  BrowserEvaluateTask,
  BrowserExtractTask,
  BrowserNavigateTask,
  BrowserTransformTask,
  BrowserWaitTask,
} from "@workglow/tasks";
import { globalServiceRegistry } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrowserTestState, createPatchedBrowserSessionManager } from "../task/browserTestRuntime";

describe("Browser workflow DAG integration", () => {
  const token = BROWSER_SESSION_MANAGER;
  let state = createBrowserTestState();

  beforeEach(() => {
    state = createBrowserTestState();
    const manager = createPatchedBrowserSessionManager(state);
    globalServiceRegistry.registerInstance(token, manager);
  });

  afterEach(() => {
    globalServiceRegistry.container.remove(token.id);
  });

  it("auto-connects context across a linear browser chain", async () => {
    const workflow = new Workflow()
      .browserNavigate({ url: "https://example.com" })
      .browserExtract({ selector: "#title", kind: "text" })
      .browserClick({ selector: "#go", delay_ms: 5 })
      .browserWait({ mode: "timeout", timeout_ms: 5 })
      .browserEvaluate({ evaluate_code: "return { seen: args.value };", args: { value: 7 } })
      .rename("result", "data")
      .rename("context", "context")
      .browserTransform({
        transform_code: "return { context, data: { doubled: data.seen * 2 } };",
      })
      .browserClose();

    const output = await workflow.run();

    expect(output.closed).toBe(true);
    expect((output.context as Record<string, unknown>).__browser).toBeUndefined();
    expect(state.clickSelectors).toEqual(["#go"]);
  });

  it("remains idempotent when explicit close task and run-end cleanup both execute", async () => {
    const workflow = new Workflow().browserNavigate({ url: "https://close-once.example" }).browserClose();
    await workflow.run();

    expect(state.closedSessions.length).toBe(1);
  });

  it("supports explicit manual branch connections", async () => {
    const workflow = new Workflow();
    const navigate = new BrowserNavigateTask({ url: "https://branch.example" }, { id: "nav" });
    const extract = new BrowserExtractTask({ selector: "#title", kind: "text" }, { id: "extract" });
    const click = new BrowserClickTask({ selector: "#go", delay_ms: 5 }, { id: "click" });

    workflow.graph.addTasks([navigate, extract, click]);
    workflow.connect("nav", "context", "extract", "context");
    workflow.connect("nav", "context", "click", "context");

    await workflow.run();

    expect(navigate.status).toBe(TaskStatus.COMPLETED);
    expect(extract.status).toBe(TaskStatus.COMPLETED);
    expect(click.status).toBe(TaskStatus.COMPLETED);
  });

  it("serializes same-session branch actions with runExclusive under parallel scheduling", async () => {
    const workflow = new Workflow();
    const navigate = new BrowserNavigateTask({ url: "https://parallel.example" }, { id: "nav" });
    const click1 = new BrowserClickTask({ selector: "#go", delay_ms: 20 }, { id: "click1" });
    const click2 = new BrowserClickTask({ selector: "#go", delay_ms: 20 }, { id: "click2" });

    workflow.graph.addTasks([navigate, click1, click2]);
    workflow.connect("nav", "context", "click1", "context");
    workflow.connect("nav", "context", "click2", "context");

    await workflow.run();

    expect(state.clickSelectors).toEqual(["#go", "#go"]);
    expect(state.maxConcurrentClicks).toBe(1);
  });
});
