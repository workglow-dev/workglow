/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Run with: RUN_QUEUE_TESTS=1 bun test task-graph-job-queue
 */

import { JobQueueClient, JobQueueServer, RateLimiter } from "@workglow/job-queue";
import { IndexedDbQueueStorage, InMemoryRateLimiterStorage } from "@workglow/storage";
import { TaskInput, TaskOutput } from "@workglow/task-graph";
import { uuid4 } from "@workglow/util";
import "fake-indexeddb/auto";
import { describe } from "vitest";
import { runGenericTaskGraphJobQueueTests, TestJob } from "./genericTaskGraphJobQueueTests";

const RUN_QUEUE_TESTS = !!process.env.RUN_QUEUE_TESTS || !!process.env.RUN_ALL_TESTS;

describe.skipIf(!RUN_QUEUE_TESTS)("IndexedDbTaskGraphJobQueue", () => {
  runGenericTaskGraphJobQueueTests(async () => {
    const queueName = `idx_test_queue_${uuid4()}`;
    const storage = new IndexedDbQueueStorage<TaskInput, TaskOutput>(queueName);
    await storage.setupDatabase();

    const server = new JobQueueServer<TaskInput, TaskOutput>(TestJob, {
      storage,
      queueName,
      limiter: new RateLimiter(new InMemoryRateLimiterStorage(), queueName, {
        maxExecutions: 1,
        windowSizeInSeconds: 10,
      }),
      pollIntervalMs: 1,
    });

    const client = new JobQueueClient<TaskInput, TaskOutput>({
      storage,
      queueName,
    });

    client.attach(server);

    return { server, client, storage };
  });
});
