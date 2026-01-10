/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DefaultKeyValueKey,
  DefaultKeyValueSchema,
  SupabaseKvRepository,
  SupabaseTabularRepository,
} from "@workglow/storage";
import { DataPortSchemaObject, FromSchema, IncludeProps, uuid4 } from "@workglow/util";
import { describe } from "vitest";
import { createSupabaseMockClient } from "../helpers/SupabaseMockClient";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";

class SupabaseTabularTestRepository<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  PrimaryKey = FromSchema<IncludeProps<Schema, PrimaryKeyNames>>,
  Entity = FromSchema<Schema>,
> extends SupabaseTabularRepository<Schema, PrimaryKeyNames, Entity, PrimaryKey> {}

describe("SupabaseKvRepository", () => {
  const client = createSupabaseMockClient();
  runGenericKvRepositoryTests(async (keyType, valueType) => {
    const tableName = `supabase_test_${uuid4().replace(/-/g, "_")}`;
    return new SupabaseKvRepository(
      client,
      tableName,
      keyType,
      valueType,
      new SupabaseTabularTestRepository(
        client,
        tableName,
        DefaultKeyValueSchema,
        DefaultKeyValueKey
      )
    );
  });
});
