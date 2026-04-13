/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from "vitest";
import { PlaywrightBackend } from "@workglow/tasks";
import { runGenericBrowserTaskTests } from "./genericBrowserTaskTests";

// Playwright requires a browser binary — skip when unavailable.
let playwrightAvailable = false;
try {
  await import("playwright");
  playwrightAvailable = true;
} catch {
  // playwright not installed
}

describe.skipIf(!playwrightAvailable)("Browser Tasks (PlaywrightBackend)", () => {
  runGenericBrowserTaskTests(() => new PlaywrightBackend());
});
