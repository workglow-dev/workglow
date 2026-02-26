/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DefaultKeyValueKey,
  DefaultKeyValueSchema,
  SupabaseKvStorage,
  SupabaseTabularStorage,
} from "@workglow/storage";
import { uuid4 } from "@workglow/util";
import { describe } from "vitest";
import { createSupabaseMockClient } from "../helpers/SupabaseMockClient";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";

describe("SupabaseKvStorage", () => {
  const client = createSupabaseMockClient();
  runGenericKvRepositoryTests(async (keyType, valueType) => {
    const tableName = `supabase_test_${uuid4().replace(/-/g, "_")}`;
    return new SupabaseKvStorage(
      client,
      tableName,
      keyType,
      valueType,
      new SupabaseTabularStorage(client, tableName, DefaultKeyValueSchema, DefaultKeyValueKey)
    );
  });
});
