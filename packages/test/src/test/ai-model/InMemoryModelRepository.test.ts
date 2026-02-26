/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryModelRepository } from "@workglow/ai";
import { describe } from "vitest";
import { runGenericModelRepositoryTests } from "./genericModelRepositoryTests";

describe("InMemoryModelRepository", () => {
  runGenericModelRepositoryTests(async () => new InMemoryModelRepository());
});
