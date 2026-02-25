/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Run with: RUN_QUEUE_TESTS=1 bun test job-queue
 */

import { InMemoryQueueStorage } from "@workglow/storage";
import { describe } from "vitest";
import { runGenericPrefixedQueueStorageTests } from "./genericPrefixedQueueStorageTests";
import { runGenericQueueStorageSubscriptionTests } from "./genericQueueStorageSubscriptionTests";

const RUN_QUEUE_TESTS = !!process.env.RUN_QUEUE_TESTS || !!process.env.RUN_ALL_TESTS;

describe.skipIf(!RUN_QUEUE_TESTS)("InMemoryPrefixedQueueStorage", () => {
  runGenericPrefixedQueueStorageTests(
    (queueName: string, options) => new InMemoryQueueStorage(queueName, options)
  );

  runGenericQueueStorageSubscriptionTests(
    (queueName: string, options) => new InMemoryQueueStorage(queueName, options),
    { usesPolling: false, sharesStateAcrossInstances: false }
  );
});
