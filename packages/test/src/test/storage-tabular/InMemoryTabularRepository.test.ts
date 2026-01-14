/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import { describe } from "vitest";
import { runGenericTabularRepositorySubscriptionTests } from "./genericTabularRepositorySubscriptionTests";
import {
  AllTypesPrimaryKeyNames,
  AllTypesSchema,
  CompoundPrimaryKeyNames,
  CompoundSchema,
  runGenericTabularRepositoryTests,
  SearchPrimaryKeyNames,
  SearchSchema,
} from "./genericTabularRepositoryTests";

describe("InMemoryTabularStorage", () => {
  runGenericTabularRepositoryTests(
    async () =>
      new InMemoryTabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>(
        CompoundSchema,
        CompoundPrimaryKeyNames
      ),
    async () =>
      new InMemoryTabularStorage<typeof SearchSchema, typeof SearchPrimaryKeyNames>(
        SearchSchema,
        SearchPrimaryKeyNames,
        ["category", ["category", "subcategory"], ["subcategory", "category"], "value"]
      ),
    async () =>
      new InMemoryTabularStorage<typeof AllTypesSchema, typeof AllTypesPrimaryKeyNames>(
        AllTypesSchema,
        AllTypesPrimaryKeyNames
      )
  );

  runGenericTabularRepositorySubscriptionTests(
    async () =>
      new InMemoryTabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>(
        CompoundSchema,
        CompoundPrimaryKeyNames
      ),
    { usesPolling: false }
  );
});
