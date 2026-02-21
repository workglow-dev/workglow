/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  IExecuteContext,
  RUN_CLEANUP_REGISTRY,
  RunCleanupRegistry,
  Task,
  TaskAbortedError,
  TaskConfigurationError,
  TaskGraph,
} from "@workglow/task-graph";
import { DataPortSchema, sleep } from "@workglow/util";
import { describe, expect, it } from "vitest";

class CleanupTask extends Task<
  { key: string; fail?: boolean; long_running?: boolean },
  { ok: boolean }
> {
  static type = "CleanupTask";

  static inputSchema() {
    return {
      type: "object",
      properties: {
        key: { type: "string" },
        fail: { type: "boolean" },
        long_running: { type: "boolean" },
      },
      required: ["key"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  static outputSchema() {
    return {
      type: "object",
      properties: {
        ok: { type: "boolean" },
      },
      required: ["ok"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: { key: string; fail?: boolean; long_running?: boolean }, context: IExecuteContext) {
    const cleanup = context.registry.get(RUN_CLEANUP_REGISTRY);
    cleanup.add(`cleanup:${input.key}`, async () => {
      cleanupCalls.push(input.key);
    });

    if (input.fail) {
      throw new TaskConfigurationError("forced failure");
    }

    if (input.long_running) {
      while (!context.signal.aborted) {
        await sleep(5);
      }
      throw new TaskAbortedError("aborted");
    }

    return { ok: true };
  }
}

const cleanupCalls: string[] = [];

describe("RunCleanupRegistry", () => {
  it("dedupes handlers by key and runs at most once", async () => {
    const registry = new RunCleanupRegistry();
    const calls: string[] = [];

    registry.add("a", () => {
      calls.push("first");
    });
    registry.add("a", () => {
      calls.push("second");
    });
    registry.add("b", () => {
      calls.push("b");
    });

    await registry.runAll();
    await registry.runAll();

    expect(calls).toEqual(["second", "b"]);
  });

  it("runs cleanup handlers on successful completion", async () => {
    cleanupCalls.length = 0;
    const graph = new TaskGraph();
    graph.addTask(new CleanupTask({ key: "complete" }, { id: "complete" }));

    await graph.run();
    expect(cleanupCalls).toContain("complete");
  });

  it("runs cleanup handlers when execution fails", async () => {
    cleanupCalls.length = 0;
    const graph = new TaskGraph();
    graph.addTask(new CleanupTask({ key: "error", fail: true }, { id: "error" }));

    await expect(graph.run()).rejects.toBeInstanceOf(TaskConfigurationError);
    expect(cleanupCalls).toContain("error");
  });

  it("runs cleanup handlers when graph is aborted", async () => {
    cleanupCalls.length = 0;
    const graph = new TaskGraph();
    graph.addTask(new CleanupTask({ key: "abort", long_running: true }, { id: "abort" }));

    const promise = graph.run();
    setTimeout(() => graph.abort(), 20);

    await expect(promise).rejects.toBeInstanceOf(TaskAbortedError);
    expect(cleanupCalls).toContain("abort");
  });
});
