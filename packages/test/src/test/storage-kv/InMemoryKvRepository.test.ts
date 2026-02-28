/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryKvStorage } from "@workglow/storage";
import { describe } from "vitest";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("InMemoryKvStorage", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericKvRepositoryTests(
    async (keyType, valueType) => new InMemoryKvStorage(keyType, valueType)
  );
});
