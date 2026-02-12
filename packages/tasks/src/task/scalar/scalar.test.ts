/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from "vitest";
import { ScalarAddTask } from "./ScalarAddTask";
import { ScalarSumTask } from "./ScalarSumTask";

describe("ScalarAddTask", () => {
  test("adds two numbers using sumPrecise", async () => {
    const task = new ScalarAddTask();
    const result = await task.run({ a: 1.1, b: 2.2 });
    expect(result.result).toBeCloseTo(3.3);
  });
});

describe("ScalarSumTask", () => {
  test("sums array of numbers", async () => {
    const task = new ScalarSumTask();
    const result = await task.run({ values: [1, 2, 3, 4, 5] });
    expect(result.result).toBe(15);
  });
});
