/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { RateLimiter } from "@workglow/job-queue";
import { InMemoryQueueStorage, InMemoryRateLimiterStorage } from "@workglow/storage";
import { describe } from "vitest";
import { runGenericJobQueueTests } from "./genericJobQueueTests";

describe("InMemoryJobQueue", () => {
  runGenericJobQueueTests(
    (queueName: string) => new InMemoryQueueStorage(queueName),
    (queueName: string, maxExecutions: number, windowSizeInSeconds: number) =>
      new RateLimiter(new InMemoryRateLimiterStorage(), queueName, {
        maxExecutions,
        windowSizeInSeconds,
      })
  );
});
