/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IndexedDbKvStorage } from "@workglow/storage";
import { uuid4 } from "@workglow/util";
import "fake-indexeddb/auto";
import { describe } from "vitest";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";

describe("IndexedDbKvStorage", () => {
  const dbName = `idx_test_${uuid4().replace(/-/g, "_")}`;

  runGenericKvRepositoryTests(
    async (keyType, valueType) => new IndexedDbKvStorage(`${dbName}`, keyType, valueType)
  );
});
