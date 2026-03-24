/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite } from "@workglow/storage/sqlite";
import { SqliteQueueStorage } from "@workglow/storage";
import { describe } from "vitest";
import { runGenericPrefixedQueueStorageTests } from "./genericPrefixedQueueStorageTests";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";

const db = new Sqlite.Database(":memory:");

describe("SqlitePrefixedQueueStorage", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericPrefixedQueueStorageTests(
    (queueName: string, options) => new SqliteQueueStorage(db, queueName, options)
  );
});
