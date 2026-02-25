/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Run with: RUN_QUEUE_TESTS=1 bun test job-queue
 */

import { RateLimiter } from "@workglow/job-queue";
import { SupabaseQueueStorage, SupabaseRateLimiterStorage } from "@workglow/storage";
import { describe } from "vitest";
import { createSupabaseMockClient } from "../helpers/SupabaseMockClient";
import { runGenericJobQueueTests } from "./genericJobQueueTests";

const RUN_QUEUE_TESTS = !!process.env.RUN_QUEUE_TESTS || !!process.env.RUN_ALL_TESTS;
const client = createSupabaseMockClient();

describe.skipIf(!RUN_QUEUE_TESTS)("SupabaseJobQueue", () => {
  runGenericJobQueueTests(
    (queueName: string) => new SupabaseQueueStorage(client, queueName),
    async (queueName: string, maxExecutions: number, windowSizeInSeconds: number) => {
      const storage = new SupabaseRateLimiterStorage(client);
      await storage.setupDatabase();
      return new RateLimiter(storage, queueName, {
        maxExecutions,
        windowSizeInSeconds,
      });
    }
  );
});
