/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Run with: RUN_QUEUE_TESTS=1 bun test job-queue
 */

import { RateLimiter } from "@workglow/job-queue";
import { IndexedDbQueueStorage, IndexedDbRateLimiterStorage } from "@workglow/storage";
import "fake-indexeddb/auto";
import { describe } from "vitest";
import { runGenericJobQueueTests } from "./genericJobQueueTests";

const RUN_QUEUE_TESTS = !!process.env.RUN_QUEUE_TESTS || !!process.env.RUN_ALL_TESTS;

describe.skipIf(!RUN_QUEUE_TESTS)("IndexedDbJobQueue", () => {
  runGenericJobQueueTests(
    (queueName: string) => new IndexedDbQueueStorage(queueName),
    async (queueName: string, maxExecutions: number, windowSizeInSeconds: number) => {
      const storage = new IndexedDbRateLimiterStorage();
      await storage.setupDatabase();
      return new RateLimiter(storage, queueName, {
        maxExecutions,
        windowSizeInSeconds,
      });
    }
  );
});
