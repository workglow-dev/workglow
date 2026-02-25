/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FsFolderJsonKvStorage } from "@workglow/storage";
import { mkdirSync, rmSync } from "fs";
import { afterEach, beforeEach, describe } from "vitest";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";

const RUN_STORAGE_TESTS = !!process.env.RUN_STORAGE_TESTS || !!process.env.RUN_ALL_TESTS;
const testDir = ".cache/test/kv-fs-folder-json";

describe.skipIf(!RUN_STORAGE_TESTS)("FsFolderJsonKvStorage", () => {
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
