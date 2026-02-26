/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConcurrencyLimiter, JobQueueClient, JobQueueServer } from "@workglow/job-queue";
import { InMemoryQueueStorage } from "@workglow/storage";
import { TaskInput, TaskOutput } from "@workglow/task-graph";
import { uuid4 } from "@workglow/util";
import { describe } from "vitest";
import { runGenericTaskGraphJobQueueTests, TestJob } from "./genericTaskGraphJobQueueTests";

describe("InMemoryTaskGraphJobQueue", () => {
  runGenericTaskGraphJobQueueTests(async () => {
    const queueName = `inMemory_test_queue_${uuid4()}`;
    const storage = new InMemoryQueueStorage<TaskInput, TaskOutput>(queueName);
    await storage.setupDatabase();

    const server = new JobQueueServer<TaskInput, TaskOutput>(TestJob, {
      storage,
      queueName,
      limiter: new ConcurrencyLimiter(1, 10),
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
