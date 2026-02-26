/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { RateLimiter } from "@workglow/job-queue";
import { PostgresQueueStorage, PostgresRateLimiterStorage } from "@workglow/storage";
import { Pool } from "pg";
import { describe } from "vitest";
import { runGenericJobQueueTests } from "./genericJobQueueTests";

const db = new PGlite() as unknown as Pool;

describe("PostgresJobQueue", () => {
  runGenericJobQueueTests(
    (queueName: string) => new PostgresQueueStorage(db, queueName),
    async (queueName: string, maxExecutions: number, windowSizeInSeconds: number) => {
      const storage = new PostgresRateLimiterStorage(db);
      await storage.setupDatabase();
      return new RateLimiter(storage, queueName, {
        maxExecutions,
        windowSizeInSeconds,
      });
    }
  );
});
