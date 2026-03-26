/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IJobExecuteContext, Job } from "@workglow/job-queue";
import {
  getTaskQueueRegistry,
  JobQueueTask,
  RegisteredQueue,
  TaskInput,
  TaskOutput,
} from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, expect, it } from "vitest";

export class TestJob extends Job<TaskInput, TaskOutput> {
  async execute(input: TaskInput, context: IJobExecuteContext): Promise<TaskOutput> {
    return { result: (input as any).a + (input as any).b };
  }
}

export class TestJobTask extends JobQueueTask<{ a: number; b: number }, { result: number }> {
  static readonly type: string = "TestJobTask";
  static readonly inputSchema = (): DataPortSchema =>
    ({
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
      additionalProperties: false,
      required: ["a", "b"],
    }) as const satisfies DataPortSchema;
  static readonly outputSchema = (): DataPortSchema =>
    ({
      type: "object",
      properties: {
        result: { type: "number" },
      },
      additionalProperties: false,
      required: ["result"],
    }) as const satisfies DataPortSchema;
}

export function runGenericTaskGraphJobQueueTests(
  createQueue: () => Promise<RegisteredQueue<TaskInput, TaskOutput>>
): void {
  let registeredQueue: RegisteredQueue<TaskInput, TaskOutput>;

  beforeEach(async () => {
    registeredQueue = await createQueue();
    getTaskQueueRegistry().registerQueue(registeredQueue);
  });

  afterEach(async () => {
    await registeredQueue.server.stop();
    await registeredQueue.storage.deleteAll();
  });

  it("should run a task via job queue", async () => {
    await registeredQueue.server.start();
    const task = new TestJobTask(
      { a: 1, b: 2 },
      {
        queue: registeredQueue.server.queueName,
      }
    );
    const result = await task.run();
    expect(result).toEqual({ result: 3 });
  });

  it("should not run a task via job queue if not started", async () => {
    const task = new TestJobTask(
      { a: 1, b: 2 },
      {
        queue: registeredQueue.server.queueName,
      }
    );
    const wait = (ms: number, result: unknown) =>
      new Promise((resolve) => setTimeout(resolve, ms, result));
    const result = await Promise.race([task.run(), wait(10, "STOP")]);
    expect(result).toEqual("STOP");
  });
}
