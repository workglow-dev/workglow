/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { PostgresQueueStorage } from "@workglow/storage";
import { Pool } from "pg";
import { describe } from "vitest";
import { runGenericPrefixedQueueStorageTests } from "./genericPrefixedQueueStorageTests";

const db = new PGlite() as unknown as Pool;

describe("PostgresPrefixedQueueStorage", () => {
  runGenericPrefixedQueueStorageTests(
    (queueName: string, options) => new PostgresQueueStorage(db, queueName, options)
  );
});
