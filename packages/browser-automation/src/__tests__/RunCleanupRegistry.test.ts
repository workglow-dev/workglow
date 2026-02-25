/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "bun:test";
import { RunCleanupRegistry } from "../session/RunCleanupRegistry";

describe("RunCleanupRegistry", () => {
  it("runs all registered handlers", async () => {
    const registry = new RunCleanupRegistry();
    const calls: string[] = [];

    registry.add("a", () => {
      calls.push("a");
    });
    registry.add("b", async () => {
      calls.push("b");
    });

    await registry.runAll();
    expect(calls).toContain("a");
    expect(calls).toContain("b");
    expect(calls.length).toBe(2);
  });

  it("deduplicates by key", async () => {
    const registry = new RunCleanupRegistry();
    const calls: string[] = [];

    registry.add("x", () => calls.push("first"));
    registry.add("x", () => calls.push("second"));

    await registry.runAll();
    // The second registration replaces the first
    expect(calls).toEqual(["second"]);
  });

  it("runs at most once", async () => {
    const registry = new RunCleanupRegistry();
    let count = 0;

    registry.add("a", () => {
      count++;
    });

    await registry.runAll();
    await registry.runAll(); // second call should be no-op
    expect(count).toBe(1);
  });

  it("executes immediately when adding after completion", async () => {
    const registry = new RunCleanupRegistry();
    await registry.runAll();

    const calls: string[] = [];
    registry.add("late", () => {
      calls.push("late");
    });

    // Give the microtask queue time to process
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual(["late"]);
  });

  it("respects LIFO mode", async () => {
    const registry = new RunCleanupRegistry();
    const order: string[] = [];

    registry.add("first", async () => order.push("first"));
    registry.add("second", async () => order.push("second"));
    registry.add("third", async () => order.push("third"));

    await registry.runAll({ mode: "lifo", concurrency: 1 });
    expect(order).toEqual(["third", "second", "first"]);
  });

  it("respects concurrency limit", async () => {
    const registry = new RunCleanupRegistry();
    let running = 0;
    let maxConcurrent = 0;

    const makeHandler = (name: string) => async () => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
    };

    registry.add("a", makeHandler("a"));
    registry.add("b", makeHandler("b"));
    registry.add("c", makeHandler("c"));
    registry.add("d", makeHandler("d"));

    await registry.runAll({ concurrency: 2 });
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("swallows handler errors", async () => {
    const registry = new RunCleanupRegistry();
    const calls: string[] = [];

    registry.add("fail", async () => {
      throw new Error("boom");
    });
    registry.add("ok", () => {
      calls.push("ok");
    });

    // Should not throw
    await registry.runAll();
    expect(calls).toContain("ok");
  });

  it("remove() removes a handler before runAll", async () => {
    const registry = new RunCleanupRegistry();
    const calls: string[] = [];

    registry.add("a", () => calls.push("a"));
    registry.add("b", () => calls.push("b"));
    registry.remove("a");

    await registry.runAll();
    expect(calls).toEqual(["b"]);
  });

  it("isCompleted reflects state", async () => {
    const registry = new RunCleanupRegistry();
    expect(registry.isCompleted).toBe(false);
    await registry.runAll();
    expect(registry.isCompleted).toBe(true);
  });
});
