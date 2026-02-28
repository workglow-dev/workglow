/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SupabaseTabularStorage } from "@workglow/storage";
import { uuid4, setLogger } from "@workglow/util";
import { describe } from "vitest";
import { createSupabaseMockClient } from "../helpers/SupabaseMockClient";
import {
  AllTypesPrimaryKeyNames,
  AllTypesSchema,
  CompoundPrimaryKeyNames,
  CompoundSchema,
  runGenericTabularRepositoryTests,
  SearchPrimaryKeyNames,
  SearchSchema,
} from "./genericTabularRepositoryTests";
import { getTestingLogger } from "../../binding/TestingLogger";

const client = createSupabaseMockClient();

describe("SupabaseTabularStorage", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericTabularRepositoryTests(
    async () =>
      new SupabaseTabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>(
        client,
        `supabase_test_${uuid4().replace(/-/g, "_")}`,
        CompoundSchema,
        CompoundPrimaryKeyNames
      ),
    async () =>
      new SupabaseTabularStorage<typeof SearchSchema, typeof SearchPrimaryKeyNames>(
        client,
        `supabase_test_${uuid4().replace(/-/g, "_")}`,
        SearchSchema,
        SearchPrimaryKeyNames,
        ["category", ["category", "subcategory"], ["subcategory", "category"], "value"]
      ),
    async () => {
      const repo = new SupabaseTabularStorage<
        typeof AllTypesSchema,
        typeof AllTypesPrimaryKeyNames
      >(
        client,
        `supabase_test_${uuid4().replace(/-/g, "_")}`,
        AllTypesSchema,
        AllTypesPrimaryKeyNames
      );
      await repo.setupDatabase();
      return repo;
    }
  );

  // Subscription tests skipped for Supabase because mock client doesn't support realtime
  // In production, Supabase uses realtime subscriptions which require a real Supabase instance
});
