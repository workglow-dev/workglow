/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from "vitest";
import { InMemoryTaskOutputRepository } from "../../binding/InMemoryTaskOutputRepository";
import { runGenericTaskOutputRepositoryTests } from "./genericTaskOutputRepositoryTests";

describe("InMemoryTaskOutputRepository", () => {
  runGenericTaskOutputRepositoryTests(async () => new InMemoryTaskOutputRepository());
});
