/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryQueueStorage } from "@workglow/storage";
import { describe } from "vitest";
import { runGenericPrefixedQueueStorageTests } from "./genericPrefixedQueueStorageTests";
import { runGenericQueueStorageSubscriptionTests } from "./genericQueueStorageSubscriptionTests";

describe("InMemoryPrefixedQueueStorage", () => {
  runGenericPrefixedQueueStorageTests(
    (queueName: string, options) => new InMemoryQueueStorage(queueName, options)
  );

  runGenericQueueStorageSubscriptionTests(
    (queueName: string, options) => new InMemoryQueueStorage(queueName, options),
    { usesPolling: false, sharesStateAcrossInstances: false }
  );
});
