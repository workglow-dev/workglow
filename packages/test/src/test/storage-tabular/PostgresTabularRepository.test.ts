/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PGlite } from "@electric-sql/pglite";
import { PostgresTabularStorage } from "@workglow/storage";
import { uuid4 } from "@workglow/util";
import type { Pool } from "pg";
import { describe } from "vitest";
import {
  AllTypesPrimaryKeyNames,
  AllTypesSchema,
  CompoundPrimaryKeyNames,
  CompoundSchema,
  runGenericTabularRepositoryTests,
  SearchPrimaryKeyNames,
  SearchSchema,
} from "./genericTabularRepositoryTests";

const db = new PGlite() as unknown as Pool;

describe("PostgresTabularStorage", () => {
  runGenericTabularRepositoryTests(
    async () =>
      new PostgresTabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>(
        db,
        `sql_test_${uuid4().replace(/-/g, "_")}`,
        CompoundSchema,
        CompoundPrimaryKeyNames
      ),
    async () =>
      new PostgresTabularStorage<typeof SearchSchema, typeof SearchPrimaryKeyNames>(
        db,
        `sql_test_${uuid4().replace(/-/g, "_")}`,
        SearchSchema,
        SearchPrimaryKeyNames,
        ["category", ["category", "subcategory"], ["subcategory", "category"], "value"]
      ),
    async () => {
      const repo = new PostgresTabularStorage<
        typeof AllTypesSchema,
        typeof AllTypesPrimaryKeyNames
      >(
        db,
        `all_types_test_${uuid4().replace(/-/g, "_")}`,
        AllTypesSchema,
        AllTypesPrimaryKeyNames
      );
      await repo.setupDatabase();
      return repo;
    }
  );
});
