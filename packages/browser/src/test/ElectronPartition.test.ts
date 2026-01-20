/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "bun:test";
import { ElectronContext } from "../context/ElectronContext";
import { CookieStore } from "../context/CookieStore";

describe("Electron Session Partitions", () => {
  it("should support partition configuration", () => {
    const cookies = new CookieStore();
    
    // Persistent partition
    const context1 = new ElectronContext(
      { partition: "persist:user-session", headless: true },
      cookies
    );
    expect(context1.config.partition).toBe("persist:user-session");

    // In-memory partition
    const context2 = new ElectronContext(
      { partition: "guest-session", headless: true },
      cookies
    );
    expect(context2.config.partition).toBe("guest-session");

    // No partition (uses default)
    const context3 = new ElectronContext(
      { headless: true },
      cookies
    );
    expect(context3.config.partition).toBeUndefined();
  });

  it("should distinguish between persistent and in-memory partitions", () => {
    const cookies = new CookieStore();
    
    // Persistent partition (survives restarts)
    const persistentConfig = {
      partition: "persist:account-1",
      headless: true,
    };
    const persistentContext = new ElectronContext(persistentConfig, cookies);
    expect(persistentContext.config.partition).toContain("persist:");

    // In-memory partition (cleared on quit)
    const tempConfig = {
      partition: "temp-session",
      headless: true,
    };
    const tempContext = new ElectronContext(tempConfig, cookies);
    expect(tempContext.config.partition).not.toContain("persist:");
  });
});
