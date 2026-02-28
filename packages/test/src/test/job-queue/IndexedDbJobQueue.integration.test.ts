/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { RateLimiter } from "@workglow/job-queue";
import { IndexedDbQueueStorage, IndexedDbRateLimiterStorage } from "@workglow/storage";
import "fake-indexeddb/auto";
import { describe } from "vitest";
import { runGenericJobQueueTests } from "./genericJobQueueTests";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("IndexedDbJobQueue", () => {
  let logger = getTestingLogger();
  setLogger(logger);
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
