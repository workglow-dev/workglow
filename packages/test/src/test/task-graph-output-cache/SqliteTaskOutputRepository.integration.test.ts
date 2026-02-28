/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid4, setLogger } from "@workglow/util";
import { describe } from "vitest";
import { SqliteTaskOutputRepository } from "../../binding/SqliteTaskOutputRepository";
import { runGenericTaskOutputRepositoryTests } from "./genericTaskOutputRepositoryTests";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("SqliteTaskOutputRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericTaskOutputRepositoryTests(async () => {
    const id = uuid4().replace(/-/g, "_");
    const dbName = `task_output_test_${id}`;
    return new SqliteTaskOutputRepository(":memory:", dbName);
  });
});
