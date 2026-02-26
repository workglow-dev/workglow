/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { RateLimiter } from "@workglow/job-queue";
import { Sqlite } from "@workglow/sqlite";
import { SqliteQueueStorage, SqliteRateLimiterStorage } from "@workglow/storage";
import { describe } from "vitest";
import { runGenericJobQueueTests } from "./genericJobQueueTests";

const db = new Sqlite.Database(":memory:");

describe("SqliteJobQueue", () => {
  runGenericJobQueueTests(
    (queueName: string) => new SqliteQueueStorage(db, queueName),
    async (queueName: string, maxExecutions: number, windowSizeInSeconds: number) => {
      const storage = new SqliteRateLimiterStorage(db);
      await storage.setupDatabase();
      return new RateLimiter(storage, queueName, {
        maxExecutions,
        windowSizeInSeconds,
      });
    }
  );
});
