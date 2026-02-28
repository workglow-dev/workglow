/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid4, setLogger } from "@workglow/util";
import "fake-indexeddb/auto";
import { describe } from "vitest";
import { IndexedDbTaskGraphRepository } from "../../binding/IndexedDbTaskGraphRepository";
import { runGenericTaskGraphRepositoryTests } from "./genericTaskGraphRepositoryTests";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("IndexedDbTaskGraphRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericTaskGraphRepositoryTests(async () => {
    const table = `task_graph_test_${uuid4().replace(/-/g, "_")}`;
    return new IndexedDbTaskGraphRepository(table);
  });
});
