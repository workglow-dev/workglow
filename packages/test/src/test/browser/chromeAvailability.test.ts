/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from "vitest";
import { isChromeAvailable } from "./chromeAvailability";

describe("isChromeAvailable", () => {
  test("returns true when a Chrome binary is on PATH", () => {
    expect(
      isChromeAvailable({
        which: (command: string) => (command === "google-chrome" ? "/usr/bin/google-chrome" : null),
        env: {},
        platform: "linux",
        fileExists: () => false,
      })
    ).toBe(true);
  });

  test("returns true when an env var points to an existing Chrome binary", () => {
    expect(
      isChromeAvailable({
        which: () => null,
        env: { CHROME_BIN: "/custom/chrome" },
        platform: "linux",
        fileExists: (filePath: string) => filePath === "/custom/chrome",
      })
    ).toBe(true);
  });

  test("returns false when no Chrome binary is discoverable", () => {
    expect(
      isChromeAvailable({
        which: () => null,
        env: {},
        platform: "linux",
        fileExists: () => false,
      })
    ).toBe(false);
  });
});
