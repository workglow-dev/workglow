/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from "vitest";
import { InMemoryTaskOutputRepository } from "../../binding/InMemoryTaskOutputRepository";
import { runGenericTaskOutputRepositoryTests } from "./genericTaskOutputRepositoryTests";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("InMemoryTaskOutputRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericTaskOutputRepositoryTests(async () => new InMemoryTaskOutputRepository());
});
