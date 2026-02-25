/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { assertSafeLaunchOptions, BLOCKED_LAUNCH_OPTION_KEYS } from "@workglow/browser-automation";

describe("assertSafeLaunchOptions", () => {
  it("throws for executablePath", () => {
    expect(() => assertSafeLaunchOptions({ executablePath: "/bin/evil" })).toThrow("executablePath");
  });

  it("throws for args", () => {
    expect(() => assertSafeLaunchOptions({ args: ["--no-sandbox"] })).toThrow("args");
  });

  it("throws for env", () => {
    expect(() => assertSafeLaunchOptions({ env: { LD_PRELOAD: "/evil.so" } })).toThrow("env");
  });

  it("allows safe options (timeout, slowMo, devtools)", () => {
    expect(() =>
      assertSafeLaunchOptions({ timeout: 30000, slowMo: 100, devtools: false })
    ).not.toThrow();
  });

  it("BLOCKED_LAUNCH_OPTION_KEYS contains the three dangerous keys", () => {
    expect(BLOCKED_LAUNCH_OPTION_KEYS.has("executablePath")).toBe(true);
    expect(BLOCKED_LAUNCH_OPTION_KEYS.has("args")).toBe(true);
    expect(BLOCKED_LAUNCH_OPTION_KEYS.has("env")).toBe(true);
  });
});
