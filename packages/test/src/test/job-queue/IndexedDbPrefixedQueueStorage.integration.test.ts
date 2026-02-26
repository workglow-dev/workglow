/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IndexedDbQueueStorage } from "@workglow/storage";
import "fake-indexeddb/auto";
import { describe } from "vitest";
import { runGenericPrefixedQueueStorageTests } from "./genericPrefixedQueueStorageTests";
import { runGenericQueueStorageSubscriptionTests } from "./genericQueueStorageSubscriptionTests";

describe("IndexedDbPrefixedQueueStorage", () => {
  runGenericPrefixedQueueStorageTests(
    (queueName: string, options) => new IndexedDbQueueStorage(queueName, options)
  );

  runGenericQueueStorageSubscriptionTests(
    (queueName: string, options) => new IndexedDbQueueStorage(queueName, options),
    { usesPolling: true, pollingIntervalMs: 1 }
  );
});
