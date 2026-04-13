/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from "vitest";
import { MockBrowserContext } from "./MockBrowserContext";
import { runGenericBrowserTaskTests } from "./genericBrowserTaskTests";

describe("Browser Tasks (MockBrowserContext)", () => {
  runGenericBrowserTaskTests(() => new MockBrowserContext());
});
