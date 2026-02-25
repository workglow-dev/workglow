/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Run with: RUN_STORAGE_TESTS=1 bun test storage-kv
 */

import { InMemoryKvStorage } from "@workglow/storage";
import { describe } from "vitest";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";

const RUN_STORAGE_TESTS = !!process.env.RUN_STORAGE_TESTS || !!process.env.RUN_ALL_TESTS;

describe.skipIf(!RUN_STORAGE_TESTS)("InMemoryKvStorage", () => {
  runGenericKvRepositoryTests(
    async (keyType, valueType) => new InMemoryKvStorage(keyType, valueType)
  );
});
