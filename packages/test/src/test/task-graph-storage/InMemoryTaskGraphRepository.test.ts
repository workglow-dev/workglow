/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from "vitest";
import { InMemoryTaskGraphRepository } from "../../binding/InMemoryTaskGraphRepository";
import { runGenericTaskGraphRepositoryTests } from "./genericTaskGraphRepositoryTests";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("InMemoryTaskGraphRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericTaskGraphRepositoryTests(async () => new InMemoryTaskGraphRepository());
});
