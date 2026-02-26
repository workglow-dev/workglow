/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid4 } from "@workglow/util";
import { describe } from "vitest";
import { SqliteTaskGraphRepository } from "../../binding/SqliteTaskGraphRepository";
import { runGenericTaskGraphRepositoryTests } from "./genericTaskGraphRepositoryTests";

describe("SqliteTaskGraphRepository", () => {
  runGenericTaskGraphRepositoryTests(async () => {
    const table = `task_graph_test_${uuid4().replace(/-/g, "_")}`;
    return new SqliteTaskGraphRepository(":memory:", table);
  });
});
