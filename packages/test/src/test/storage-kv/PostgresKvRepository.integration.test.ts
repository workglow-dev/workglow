/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { PostgresKvStorage } from "@workglow/storage";
import { uuid4 } from "@workglow/util";
import type { Pool } from "pg";
import { describe } from "vitest";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";

const db = new PGlite() as unknown as Pool;

describe("PostgresKvStorage", () => {
  runGenericKvRepositoryTests(async (keyType, valueType) => {
    const dbName = `pg_test_${uuid4().replace(/-/g, "_")}`;
    return new PostgresKvStorage(db, dbName, keyType, valueType);
  });
});
