/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid4 } from "@workglow/util";
import { describe } from "vitest";
import { SqliteModelRepository } from "../../binding/SqliteModelRepository";
import { runGenericModelRepositoryTests } from "./genericModelRepositoryTests";

const RUN_STORAGE_TESTS = !!process.env.RUN_STORAGE_TESTS || !!process.env.RUN_ALL_TESTS;

describe.skipIf(!RUN_STORAGE_TESTS)("SqliteModelRepository", () => {
  runGenericModelRepositoryTests(async () => {
    const id = uuid4().replace(/-/g, "_");
    return new SqliteModelRepository(":memory:", `aimodel_test_${id}`);
  });
});
