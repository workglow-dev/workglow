/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "bun:test";
import { FifoMutex } from "../session/FifoMutex";

describe("FifoMutex", () => {
  it("executes a single function", async () => {
    const mutex = new FifoMutex();
    const result = await mutex.runExclusive(async () => 42);
    expect(result).toBe(42);
  });

  it("guarantees FIFO ordering", async () => {
    const mutex = new FifoMutex();
    const order: number[] = [];

    const promises = [
      mutex.runExclusive(async () => {
        await new Promise((r) => setTimeout(r, 30));
        order.push(1);
      }),
      mutex.runExclusive(async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(2);
      }),
      mutex.runExclusive(async () => {
        order.push(3);
      }),
    ];

    await Promise.all(promises);
    expect(order).toEqual([1, 2, 3]);
  });

  it("does not execute in parallel", async () => {
    const mutex = new FifoMutex();
    let running = 0;
    let maxConcurrent = 0;

    const run = async () => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
    };

    await Promise.all([mutex.runExclusive(run), mutex.runExclusive(run), mutex.runExclusive(run)]);

    expect(maxConcurrent).toBe(1);
  });

  it("propagates errors without breaking the queue", async () => {
    const mutex = new FifoMutex();
    const results: string[] = [];

    const p1 = mutex
      .runExclusive(async () => {
        throw new Error("fail");
      })
      .catch((e) => results.push(`error:${(e as Error).message}`));

    const p2 = mutex.runExclusive(async () => {
      results.push("success");
    });

    await Promise.all([p1, p2]);
    expect(results).toContain("error:fail");
    expect(results).toContain("success");
    expect(results.length).toBe(2);
  });
});
