/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "bun:test";
import { sanitizeBrowserSessionConfig } from "./context";
import type { BrowserSessionConfig } from "./context";

describe("sanitizeBrowserSessionConfig", () => {
  it("strips remoteCdp.apiKey", () => {
    const config: BrowserSessionConfig = {
      remoteCdp: {
        endpoint: "wss://example.com",
        provider: "browserless",
        apiKey: "secret-api-key",
        region: "us-east-1",
        zone: "zone-a",
      },
    };
    const result = sanitizeBrowserSessionConfig(config);
    expect(result.remoteCdp?.apiKey).toBeUndefined();
    expect("apiKey" in (result.remoteCdp ?? {})).toBe(false);
  });

  it("preserves non-sensitive remoteCdp fields", () => {
    const config: BrowserSessionConfig = {
      remoteCdp: {
        endpoint: "wss://example.com",
        provider: "brightdata",
        apiKey: "secret-api-key",
        region: "eu-west-1",
        zone: "zone-b",
      },
    };
    const result = sanitizeBrowserSessionConfig(config);
    expect(result.remoteCdp?.endpoint).toBe("wss://example.com");
    expect(result.remoteCdp?.provider).toBe("brightdata");
    expect(result.remoteCdp?.region).toBe("eu-west-1");
    expect(result.remoteCdp?.zone).toBe("zone-b");
  });

  it("strips playwright.storageState (string path)", () => {
    const config: BrowserSessionConfig = {
      playwright: {
        browserType: "chromium",
        storageState: "/path/to/auth.json",
      },
    };
    const result = sanitizeBrowserSessionConfig(config);
    expect(result.playwright?.storageState).toBeUndefined();
    expect("storageState" in (result.playwright ?? {})).toBe(false);
  });

  it("strips playwright.storageState (object with cookies)", () => {
    const config: BrowserSessionConfig = {
      playwright: {
        browserType: "firefox",
        storageState: {
          cookies: [{ name: "session", value: "token123", domain: "example.com", path: "/" }],
          origins: [],
        },
      },
    };
    const result = sanitizeBrowserSessionConfig(config);
    expect(result.playwright?.storageState).toBeUndefined();
  });

  it("preserves non-sensitive playwright fields", () => {
    const config: BrowserSessionConfig = {
      playwright: {
        browserType: "webkit",
        launchOptions: { args: ["--no-sandbox"] },
        contextOptions: { locale: "en-US" },
        storageState: "/path/to/auth.json",
      },
    };
    const result = sanitizeBrowserSessionConfig(config);
    expect(result.playwright?.browserType).toBe("webkit");
    expect(result.playwright?.launchOptions).toEqual({ args: ["--no-sandbox"] });
    expect(result.playwright?.contextOptions).toEqual({ locale: "en-US" });
  });

  it("handles config with neither remoteCdp nor playwright", () => {
    const config: BrowserSessionConfig = {
      headless: true,
      viewport: { width: 1280, height: 720 },
      userAgent: "test-agent",
      timeoutMs: 5000,
    };
    const result = sanitizeBrowserSessionConfig(config);
    expect(result.headless).toBe(true);
    expect(result.viewport).toEqual({ width: 1280, height: 720 });
    expect(result.userAgent).toBe("test-agent");
    expect(result.timeoutMs).toBe(5000);
  });

  it("handles config with remoteCdp but no apiKey", () => {
    const config: BrowserSessionConfig = {
      remoteCdp: { endpoint: "wss://example.com" },
    };
    const result = sanitizeBrowserSessionConfig(config);
    expect(result.remoteCdp?.endpoint).toBe("wss://example.com");
    expect(result.remoteCdp?.apiKey).toBeUndefined();
  });

  it("handles config with playwright but no storageState", () => {
    const config: BrowserSessionConfig = {
      playwright: { browserType: "chromium" },
    };
    const result = sanitizeBrowserSessionConfig(config);
    expect(result.playwright?.browserType).toBe("chromium");
    expect(result.playwright?.storageState).toBeUndefined();
  });

  it("does not mutate the original config", () => {
    const config: BrowserSessionConfig = {
      remoteCdp: { apiKey: "secret" },
      playwright: { storageState: "path/to/state.json" },
    };
    sanitizeBrowserSessionConfig(config);
    expect(config.remoteCdp?.apiKey).toBe("secret");
    expect(config.playwright?.storageState).toBe("path/to/state.json");
  });

  it("strips both remoteCdp.apiKey and playwright.storageState together", () => {
    const config: BrowserSessionConfig = {
      headless: false,
      remoteCdp: {
        endpoint: "wss://cdp.example.com",
        apiKey: "my-secret-key",
      },
      playwright: {
        browserType: "chromium",
        storageState: { cookies: [], origins: [] },
      },
    };
    const result = sanitizeBrowserSessionConfig(config);
    expect(result.remoteCdp?.apiKey).toBeUndefined();
    expect(result.playwright?.storageState).toBeUndefined();
    expect(result.remoteCdp?.endpoint).toBe("wss://cdp.example.com");
    expect(result.playwright?.browserType).toBe("chromium");
    expect(result.headless).toBe(false);
  });
});
