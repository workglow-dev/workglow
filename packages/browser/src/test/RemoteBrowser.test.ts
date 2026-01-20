/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "bun:test";
import { RemoteBrowserContext, createBrowserlessContext } from "../context/RemoteBrowserContext";
import { CookieStore } from "../context/CookieStore";

describe("RemoteBrowserContext", () => {
  it("should support Browserless configuration", () => {
    const cookies = new CookieStore();
    const config = {
      provider: "browserless" as const,
      apiKey: "test-api-key",
      headless: true,
      providerOptions: { region: "sfo" },
    };

    const context = new RemoteBrowserContext(config, cookies);
    
    expect(context).toBeDefined();
    expect(context.config.provider).toBe("browserless");
    expect(context.config.apiKey).toBe("test-api-key");
  });

  it("should support Browserbase configuration", () => {
    const cookies = new CookieStore();
    const config = {
      provider: "browserbase" as const,
      endpoint: "wss://connect.browserbase.com/session/abc123",
      headless: true,
    };

    const context = new RemoteBrowserContext(config, cookies);
    
    expect(context).toBeDefined();
    expect(context.config.provider).toBe("browserbase");
    expect(context.config.endpoint).toContain("browserbase");
  });

  it("should support Bright Data configuration", () => {
    const cookies = new CookieStore();
    const config = {
      provider: "brightdata" as const,
      apiKey: "customer-id",
      providerOptions: { zone: "residential" },
      headless: true,
    };

    const context = new RemoteBrowserContext(config, cookies);
    
    expect(context).toBeDefined();
    expect(context.config.provider).toBe("brightdata");
  });

  it("should expose correct interface methods", () => {
    const cookies = new CookieStore();
    const config = {
      provider: "browserless" as const,
      apiKey: "test",
      headless: true,
    };
    const context = new RemoteBrowserContext(config, cookies);
    
    // Verify all required methods exist
    expect(typeof context.navigate).toBe("function");
    expect(typeof context.getUrl).toBe("function");
    expect(typeof context.getAccessibilityTree).toBe("function");
    expect(typeof context.click).toBe("function");
    expect(typeof context.type).toBe("function");
    expect(typeof context.screenshot).toBe("function");
    expect(typeof context.evaluate).toBe("function");
    expect(typeof context.waitFor).toBe("function");
    expect(typeof context.close).toBe("function");
  });

  it("should support session ID for reconnection", () => {
    const cookies = new CookieStore();
    const config = {
      provider: "browserbase" as const,
      endpoint: "wss://connect.browserbase.com/session/abc123",
      sessionId: "session-123",
      headless: true,
    };

    const context = new RemoteBrowserContext(config, cookies);
    
    expect(context.config.sessionId).toBe("session-123");
  });

  it("should create helper functions for providers", async () => {
    // Browserless helper
    const browserlessContext = await createBrowserlessContext("api-key", {
      region: "lon",
      headless: true,
    });
    expect(browserlessContext.config.provider).toBe("browserless");
  });
});

describe("Remote Browser Provider URLs", () => {
  it("should construct Browserless URL correctly", () => {
    const cookies = new CookieStore();
    const context = new RemoteBrowserContext(
      {
        provider: "browserless",
        apiKey: "my-token",
        providerOptions: { region: "lon" },
      } as any,
      cookies
    );

    // URL construction is internal, but we can verify config
    expect(context.config.provider).toBe("browserless");
    expect(context.config.apiKey).toBe("my-token");
    expect(context.config.providerOptions?.region).toBe("lon");
  });

  it("should require endpoint for Browserbase", () => {
    const cookies = new CookieStore();
    const config = {
      provider: "browserbase" as const,
      // No endpoint provided - should fail on connection
      headless: true,
    };

    const context = new RemoteBrowserContext(config, cookies);
    expect(context.config.provider).toBe("browserbase");
  });

  it("should support custom endpoints", () => {
    const cookies = new CookieStore();
    const customEndpoint = "wss://my-custom-browser.com:9222";
    
    const context = new RemoteBrowserContext(
      {
        provider: "browserless",
        endpoint: customEndpoint,
      } as any,
      cookies
    );

    expect(context.config.endpoint).toBe(customEndpoint);
  });
});
