/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid4 } from "@workglow/util";
import "fake-indexeddb/auto";
import { describe } from "vitest";
import { IndexedDbTaskOutputRepository } from "../../binding/IndexedDbTaskOutputRepository";
import { runGenericTaskOutputRepositoryTests } from "./genericTaskOutputRepositoryTests";

const RUN_STORAGE_TESTS = !!process.env.RUN_STORAGE_TESTS || !!process.env.RUN_ALL_TESTS;

describe.skipIf(!RUN_STORAGE_TESTS)("IndexedDbTaskOutputRepository", () => {
  runGenericTaskOutputRepositoryTests(async () => {
    const id = uuid4().replace(/-/g, "_");
    const dbName = `idx_test_${id}`;
    return new IndexedDbTaskOutputRepository(dbName);
  });
});
