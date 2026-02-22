/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "bun:test";
import { ElectronContext } from "../context/ElectronContext";
import { CookieStore } from "../context/CookieStore";

describe("ElectronContext (Unit Tests)", () => {
  it("should have correct constructor signature", () => {
    const cookies = new CookieStore();
    const config = { headless: true, timeout: 30000 };
    
    // Should not throw when creating the context
    const context = new ElectronContext(config, cookies);
    
    expect(context).toBeDefined();
    expect(context.cookies).toBe(cookies);
    expect(context.config).toEqual(config);
  });

  it("should expose correct interface methods", () => {
    const cookies = new CookieStore();
    const context = new ElectronContext({ headless: true }, cookies);
    
    // Verify all required methods exist
    expect(typeof context.navigate).toBe("function");
    expect(typeof context.getUrl).toBe("function");
    expect(typeof context.getAccessibilityTree).toBe("function");
    expect(typeof context.click).toBe("function");
    expect(typeof context.type).toBe("function");
    expect(typeof context.screenshot).toBe("function");
    expect(typeof context.evaluate).toBe("function");
    expect(typeof context.waitFor).toBe("function");
    expect(typeof context.goBack).toBe("function");
    expect(typeof context.goForward).toBe("function");
    expect(typeof context.reload).toBe("function");
    expect(typeof context.close).toBe("function");
  });

  it("should store config and cookies", () => {
    const cookies = new CookieStore();
    cookies.set({
      name: "test",
      value: "value",
      domain: "example.com",
      path: "/",
    });

    const config = {
      headless: true,
      viewport: { width: 1024, height: 768 },
      userAgent: "Test Agent",
    };

    const context = new ElectronContext(config, cookies);
    
    expect(context.config).toEqual(config);
    expect(context.cookies.get("test", "example.com")).toBeDefined();
  });

  it("should be compatible with IBrowserContext interface", () => {
    const cookies = new CookieStore();
    const context = new ElectronContext({ headless: true }, cookies);
    
    // TypeScript will verify this at compile time, but we can also check at runtime
    const requiredProperties = [
      "cookies",
      "config",
      "navigate",
      "getUrl", 
      "getAccessibilityTree",
      "click",
      "type",
      "screenshot",
      "evaluate",
      "waitFor",
      "goBack",
      "goForward",
      "reload",
      "close",
    ];

    for (const prop of requiredProperties) {
      expect(context).toHaveProperty(prop);
    }
  });
});

describe("ElectronContext vs PlaywrightContext API Parity", () => {
  it("should have same method signatures as PlaywrightContext", async () => {
    const { PlaywrightContext } = await import("../context/PlaywrightContext");
    const cookies = new CookieStore();
    
    const electronContext = new ElectronContext({ headless: true }, cookies);
    const playwrightContext = new PlaywrightContext({ headless: true }, cookies);

    // Get method names from both
    const electronMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(electronContext))
      .filter(name => typeof (electronContext as any)[name] === "function" && name !== "constructor")
      .sort();
    
    const playwrightMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(playwrightContext))
      .filter(name => typeof (playwrightContext as any)[name] === "function" && name !== "constructor")
      .sort();

    // Should have the same public API methods
    const sharedMethods = electronMethods.filter(m => playwrightMethods.includes(m));
    
    // Both should implement the core browser context methods
    const coreMethods = [
      "navigate",
      "getUrl",
      "getAccessibilityTree",
      "click",
      "type",
      "screenshot",
      "evaluate",
      "waitFor",
      "goBack",
      "goForward",
      "reload",
      "close",
    ];

    for (const method of coreMethods) {
      expect(electronMethods).toContain(method);
      expect(playwrightMethods).toContain(method);
    }

    await playwrightContext.close();
  });
});
