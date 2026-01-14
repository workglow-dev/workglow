/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryKvStorage } from "@workglow/storage";
import { describe } from "vitest";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";

describe("InMemoryKvStorage", () => {
  runGenericKvRepositoryTests(
    async (keyType, valueType) => new InMemoryKvStorage(keyType, valueType)
  );
});
