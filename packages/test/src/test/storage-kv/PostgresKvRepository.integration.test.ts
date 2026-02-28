/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { PostgresKvStorage } from "@workglow/storage";
import { uuid4, setLogger } from "@workglow/util";
import type { Pool } from "pg";
import { describe } from "vitest";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";
import { getTestingLogger } from "../../binding/TestingLogger";

const db = new PGlite() as unknown as Pool;

describe("PostgresKvStorage", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericKvRepositoryTests(async (keyType, valueType) => {
    const dbName = `pg_test_${uuid4().replace(/-/g, "_")}`;
    return new PostgresKvStorage(db, dbName, keyType, valueType);
  });
});
