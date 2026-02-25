/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid4 } from "@workglow/util";
import "fake-indexeddb/auto";
import { describe } from "vitest";
import { IndexedDbTaskGraphRepository } from "../../binding/IndexedDbTaskGraphRepository";
import { runGenericTaskGraphRepositoryTests } from "./genericTaskGraphRepositoryTests";

const RUN_STORAGE_TESTS = !!process.env.RUN_STORAGE_TESTS || !!process.env.RUN_ALL_TESTS;

describe.skipIf(!RUN_STORAGE_TESTS)("IndexedDbTaskGraphRepository", () => {
  runGenericTaskGraphRepositoryTests(async () => {
    const table = `task_graph_test_${uuid4().replace(/-/g, "_")}`;
    return new IndexedDbTaskGraphRepository(table);
  });
});
