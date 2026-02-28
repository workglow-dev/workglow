/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryModelRepository } from "@workglow/ai";
import { describe } from "vitest";
import { runGenericModelRepositoryTests } from "./genericModelRepositoryTests";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("InMemoryModelRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericModelRepositoryTests(async () => new InMemoryModelRepository());
});
