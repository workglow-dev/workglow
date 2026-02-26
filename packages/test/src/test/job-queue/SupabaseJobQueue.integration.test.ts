/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { RateLimiter } from "@workglow/job-queue";
import { SupabaseQueueStorage, SupabaseRateLimiterStorage } from "@workglow/storage";
import { describe } from "vitest";
import { createSupabaseMockClient } from "../helpers/SupabaseMockClient";
import { runGenericJobQueueTests } from "./genericJobQueueTests";

const client = createSupabaseMockClient();

describe("SupabaseJobQueue", () => {
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
