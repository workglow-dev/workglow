/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { loadPlaywright } from "@workglow/tasks";
import { describe, expect, it } from "vitest";

describe("Browser dependency errors", () => {
  it("returns actionable install guidance when playwright is not installed", async () => {
    const dynamicImport = new Function("moduleName", "return import(moduleName);") as (
      moduleName: string
    ) => Promise<unknown>;
    const isInstalled = await dynamicImport("playwright")
      .then(() => true)
      .catch(() => false);

    if (isInstalled) {
      return;
    }

    await expect(loadPlaywright()).rejects.toThrow(/bun add playwright|npm i playwright/);
  });
});

