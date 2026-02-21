/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserTransformTask } from "@workglow/tasks";
import { describe, expect, it } from "vitest";

describe("BrowserTransformTask", () => {
  it("transforms payload and can return explicit { context, data }", async () => {
    const task = new BrowserTransformTask();
    const result = await task.run({
      context: { a: 1 },
      data: { value: 10 },
      transform_code: "return { context: { ...context, b: 2 }, data: { value: data.value + 5 } };",
    });

    expect(result.context).toEqual({ a: 1, b: 2 });
    expect(result.data).toEqual({ value: 15 });
  });
});

