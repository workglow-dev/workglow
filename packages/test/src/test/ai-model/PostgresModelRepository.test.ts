/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { uuid4 } from "@workglow/util";
import { Pool } from "pg";
import { describe } from "vitest";
import { PostgresModelRepository } from "../../binding/PostgresModelRepository";
import { runGenericModelRepositoryTests } from "./genericModelRepositoryTests";

const db = new PGlite() as unknown as Pool;

async function createPostgresModelRepository() {
  const id = uuid4().replace(/-/g, "_");
  return new PostgresModelRepository(db, `ai_model_test_${id}`);
}

const RUN_STORAGE_TESTS = !!process.env.RUN_STORAGE_TESTS || !!process.env.RUN_ALL_TESTS;

describe.skipIf(!RUN_STORAGE_TESTS)("PostgresModelRepository", () => {
  runGenericModelRepositoryTests(createPostgresModelRepository);
});
