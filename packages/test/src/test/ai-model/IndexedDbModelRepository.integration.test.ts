/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { setLogger, uuid4 } from "@workglow/util";
import "fake-indexeddb/auto";
import { describe } from "vitest";
import { IndexedDbModelRepository } from "../../binding/IndexedDbModelRepository";
import { runGenericModelRepositoryTests } from "./genericModelRepositoryTests";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("IndexedDbModelRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericModelRepositoryTests(async () => {
    const id = uuid4().replace(/-/g, "_");
    return new IndexedDbModelRepository(`idx_model_test_${id}`);
  });
});
