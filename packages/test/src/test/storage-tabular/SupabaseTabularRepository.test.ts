/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SupabaseTabularRepository } from "@workglow/storage";
import { DataPortSchemaObject, FromSchema, IncludeProps, uuid4 } from "@workglow/util";
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

const client = createSupabaseMockClient();

class SupabaseTabularTestRepository<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  // computed types
  PrimaryKey = FromSchema<IncludeProps<Schema, PrimaryKeyNames>>,
  Entity = FromSchema<Schema>,
> extends SupabaseTabularRepository<Schema, PrimaryKeyNames, Entity, PrimaryKey> {}

describe("SupabaseTabularRepository", () => {
  runGenericTabularRepositoryTests(
    async () =>
      new SupabaseTabularTestRepository<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>(
        client,
        `supabase_test_${uuid4().replace(/-/g, "_")}`,
        CompoundSchema,
        CompoundPrimaryKeyNames
      ),
    async () =>
      new SupabaseTabularTestRepository<typeof SearchSchema, typeof SearchPrimaryKeyNames>(
        client,
        `supabase_test_${uuid4().replace(/-/g, "_")}`,
        SearchSchema,
        SearchPrimaryKeyNames,
        ["category", ["category", "subcategory"], ["subcategory", "category"], "value"]
      ),
    async () => {
      const repo = new SupabaseTabularTestRepository<
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
