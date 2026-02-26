/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SupabaseQueueStorage } from "@workglow/storage";
import { describe } from "vitest";
import { createSupabaseMockClient } from "../helpers/SupabaseMockClient";
import { runGenericPrefixedQueueStorageTests } from "./genericPrefixedQueueStorageTests";
import { runGenericQueueStorageSubscriptionTests } from "./genericQueueStorageSubscriptionTests";

const client = createSupabaseMockClient();

// Extend SupabaseQueueStorage to use polling for tests since mock doesn't support realtime
class SupabaseQueueStorageWithPolling<Input, Output> extends SupabaseQueueStorage<Input, Output> {
  public override subscribeToChanges(callback: any, options?: any): () => void {
    // Use polling instead of realtime for tests
    return this.subscribeToChangesWithPolling(callback, options);
  }
}

describe("SupabasePrefixedQueueStorage", () => {
  runGenericPrefixedQueueStorageTests(
    (queueName: string, options) => new SupabaseQueueStorage(client, queueName, options)
  );

  runGenericQueueStorageSubscriptionTests(
    (queueName: string, options) => new SupabaseQueueStorageWithPolling(client, queueName, options),
    { usesPolling: true, pollingIntervalMs: 1, sharesStateAcrossInstances: true }
  );
});
