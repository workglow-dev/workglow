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
import { uuid4, setLogger } from "@workglow/util";
import { afterAll, describe } from "vitest";
import { createSupabaseMockClient } from "../helpers/SupabaseMockClient";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("SupabaseKvStorage", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  const client = createSupabaseMockClient();

  afterAll(async () => {
    await client.close();
  });

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
