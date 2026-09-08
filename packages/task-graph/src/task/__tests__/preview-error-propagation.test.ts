/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecutePreviewContext, TaskConfig } from "@workglow/task-graph";
import { Task } from "@workglow/task-graph";
import { TaskRunner } from "../TaskRunner";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

const schema = {
  type: "object",
  properties: { a: { type: "string" } },
  additionalProperties: false,
} as const satisfies DataPortSchema;

class ThrowingPreviewTask extends Task<{ a?: string }, { a?: string }, TaskConfig> {
  public static override readonly type = "ThrowingPreviewTask";
  public static override inputSchema(): DataPortSchema {
    return schema;
  }
  public static override outputSchema(): DataPortSchema {
    return schema;
  }
  override async executePreview(_input: { a?: string }, _ctx: IExecutePreviewContext) {
    throw new Error("preview blew up");
  }
}

/** A runner whose error handler fails — the case the `finally` used to hide. */
class FailingHandlerRunner extends TaskRunner<{ a?: string }, { a?: string }> {
  protected override async handleErrorPreview(): Promise<void> {
    throw new Error("handleErrorPreview failed");
  }
}

/**
 * `runPreview` ended with `return` inside a `finally`, which discards whatever
 * completion was pending. A `runPreview` that always resolves is the intent for
 * a task's own preview failing — the preview is best-effort and the last good
 * output is what the editor should keep showing — but the `return` swallowed
 * one thing beyond that: a rejection from the error handler itself.
 *
 * Only that one. A throwing `ctx.dispose()` propagates either way, because in a
 * `finally` an abrupt completion from an earlier statement means the `return`
 * is never reached.
 */
describe("runPreview error propagation", () => {
  it("still resolves with the held output when the task's own preview throws", async () => {
    // Unchanged, and deliberately so: this is the case the comment on the
    // `finally` was describing.
    const task = new ThrowingPreviewTask();
    await expect(task.runPreview({ a: "held" })).resolves.toBeDefined();
  });

  it("rejects when the error handler itself fails, instead of reporting success", async () => {
    const task = new ThrowingPreviewTask();
    // Swap in a runner whose handler fails. Previously the `finally` return
    // discarded this rejection and `runPreview` resolved, so a failure to
    // clean up after a failed preview was invisible to every caller.
    (task as unknown as { _runner: TaskRunner<{ a?: string }, { a?: string }> })._runner =
      new FailingHandlerRunner(task as never);

    await expect(task.runPreview({ a: "held" })).rejects.toThrow("handleErrorPreview failed");
  });
});
