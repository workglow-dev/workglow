/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FsFolderJsonKvStorage } from "@workglow/storage";
import { mkdirSync, rmSync } from "fs";
import { afterEach, beforeEach, describe } from "vitest";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";

const testDir = ".cache/test/kv-fs-folder-json";

describe("FsFolderJsonKvStorage", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  beforeEach(() => {
    try {
      mkdirSync(testDir, { recursive: true });
    } catch {}
  });

  afterEach(async () => {
    try {
      rmSync(testDir, { recursive: true });
    } catch {}
  });

  runGenericKvRepositoryTests(async (keyType, valueType) => {
    return new FsFolderJsonKvStorage(testDir, keyType, valueType);
  });
});
