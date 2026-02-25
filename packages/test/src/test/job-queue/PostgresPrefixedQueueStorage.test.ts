/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Run with: RUN_QUEUE_TESTS=1 bun test job-queue
 */

import { PGlite } from "@electric-sql/pglite";
import { PostgresQueueStorage } from "@workglow/storage";
import { Pool } from "pg";
import { describe } from "vitest";
import { runGenericPrefixedQueueStorageTests } from "./genericPrefixedQueueStorageTests";

const RUN_QUEUE_TESTS = !!process.env.RUN_QUEUE_TESTS || !!process.env.RUN_ALL_TESTS;
const db = new PGlite() as unknown as Pool;

describe.skipIf(!RUN_QUEUE_TESTS)("PostgresPrefixedQueueStorage", () => {
  runGenericPrefixedQueueStorageTests(
    (queueName: string, options) => new PostgresQueueStorage(db, queueName, options)
  );
});
