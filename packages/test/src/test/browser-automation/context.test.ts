/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import {
  getBrowserEnvelope,
  setBrowserEnvelope,
  clearBrowserEnvelope,
  setBrowserLast,
  resolveOrCreateBrowserEnvelope,
  sanitizeBrowserSessionConfig,
} from "@workglow/browser-automation";
import type { BrowserEnvelope, BrowserSessionConfig, WorkflowContext } from "@workglow/browser-automation";

describe("context helpers", () => {
  const makeEnvelope = (): BrowserEnvelope => ({
    session: {
      id: "test-session-1",
      backend: "playwright",
      createdAt: "2025-01-01T00:00:00.000Z",
      config: { headless: true },
    },
    last: { url: "https://example.com", title: "Example" },
  });

  describe("getBrowserEnvelope", () => {
    it("returns undefined when no __browser present", () => {
      expect(getBrowserEnvelope({})).toBeUndefined();
    });

    it("returns the envelope when present", () => {
      const env = makeEnvelope();
      const ctx: WorkflowContext = { __browser: env };
      expect(getBrowserEnvelope(ctx)).toEqual(env);
    });
  });

  describe("setBrowserEnvelope", () => {
    it("sets the envelope on a new context", () => {
      const env = makeEnvelope();
      const ctx = setBrowserEnvelope({}, env);
      expect(ctx.__browser).toEqual(env);
    });

    it("preserves other context keys", () => {
      const env = makeEnvelope();
      const ctx = setBrowserEnvelope({ foo: "bar" } as WorkflowContext, env);
      expect((ctx as any).foo).toBe("bar");
      expect(ctx.__browser).toEqual(env);
    });
  });

  describe("clearBrowserEnvelope", () => {
    it("removes __browser from context", () => {
      const ctx: WorkflowContext = { __browser: makeEnvelope(), otherKey: "value" };
      const cleared = clearBrowserEnvelope(ctx);
      expect(cleared.__browser).toBeUndefined();
      expect((cleared as any).otherKey).toBe("value");
    });

    it("is no-op when no __browser present", () => {
      const ctx: WorkflowContext = { someData: 42 };
      const cleared = clearBrowserEnvelope(ctx);
      expect(cleared.__browser).toBeUndefined();
    });
  });

  describe("setBrowserLast", () => {
    it("updates last metadata on context", () => {
      const session = makeEnvelope().session;
      const ctx = setBrowserLast({}, { url: "https://test.com", title: "Test" }, session);
      expect(ctx.__browser?.last?.url).toBe("https://test.com");
      expect(ctx.__browser?.last?.title).toBe("Test");
      expect(ctx.__browser?.session.id).toBe("test-session-1");
    });
  });

  describe("resolveOrCreateBrowserEnvelope", () => {
    it("returns existing envelope when present", () => {
      const env = makeEnvelope();
      const ctx: WorkflowContext = { __browser: env };
      const result = resolveOrCreateBrowserEnvelope(ctx);
      expect(result).toEqual(env);
    });

    it("creates a new envelope with default config when none exists", () => {
      const result = resolveOrCreateBrowserEnvelope({});
      expect(result.session.id).toBeTruthy();
      expect(result.session.backend).toBe("playwright");
      expect(result.session.config.headless).toBe(true);
      expect(result.session.createdAt).toBeTruthy();
    });

    it("creates envelope with custom config", () => {
      const result = resolveOrCreateBrowserEnvelope(
        {},
        { headless: false, viewport: { width: 800, height: 600 } }
      );
      expect(result.session.config.headless).toBe(false);
      expect(result.session.config.viewport).toEqual({ width: 800, height: 600 });
    });

    it("infers remote-playwright-cdp backend from remoteCdp config", () => {
      const result = resolveOrCreateBrowserEnvelope(
        {},
        {
          remoteCdp: { endpoint: "wss://example.com" },
        }
      );
      expect(result.session.backend).toBe("remote-playwright-cdp");
    });

    it("infers electron backend from electronPartition persistence", () => {
      const result = resolveOrCreateBrowserEnvelope(
        {},
        {
          persistence: { kind: "electronPartition", partition: "persist:test" },
        }
      );
      expect(result.session.backend).toBe("electron");
    });

    it("allows explicit backend override", () => {
      const result = resolveOrCreateBrowserEnvelope({}, { headless: true }, "electron");
      expect(result.session.backend).toBe("electron");
    });
  });

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

    it("strips playwright.storageState when given as a file path", () => {
      const config: BrowserSessionConfig = {
        playwright: { browserType: "chromium", storageState: "/path/to/auth.json" },
      };
      const result = sanitizeBrowserSessionConfig(config);
      expect(result.playwright?.storageState).toBeUndefined();
      expect("storageState" in (result.playwright ?? {})).toBe(false);
    });

    it("strips playwright.storageState when given as a cookies object", () => {
      const config: BrowserSessionConfig = {
        playwright: {
          browserType: "firefox",
          storageState: { cookies: [{ name: "s", value: "tok", domain: "x.com", path: "/" }], origins: [] },
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
        timeoutMs: 5000,
      };
      const result = sanitizeBrowserSessionConfig(config);
      expect(result.headless).toBe(true);
      expect(result.viewport).toEqual({ width: 1280, height: 720 });
      expect(result.timeoutMs).toBe(5000);
    });

    it("handles remoteCdp without an apiKey set", () => {
      const config: BrowserSessionConfig = { remoteCdp: { endpoint: "wss://example.com" } };
      const result = sanitizeBrowserSessionConfig(config);
      expect(result.remoteCdp?.endpoint).toBe("wss://example.com");
      expect(result.remoteCdp?.apiKey).toBeUndefined();
    });

    it("handles playwright without storageState set", () => {
      const config: BrowserSessionConfig = { playwright: { browserType: "chromium" } };
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

    it("strips both remoteCdp.apiKey and playwright.storageState in one pass", () => {
      const config: BrowserSessionConfig = {
        headless: false,
        remoteCdp: { endpoint: "wss://cdp.example.com", apiKey: "my-secret-key" },
        playwright: { browserType: "chromium", storageState: { cookies: [], origins: [] } },
      };
      const result = sanitizeBrowserSessionConfig(config);
      expect(result.remoteCdp?.apiKey).toBeUndefined();
      expect(result.playwright?.storageState).toBeUndefined();
      expect(result.remoteCdp?.endpoint).toBe("wss://cdp.example.com");
      expect(result.playwright?.browserType).toBe("chromium");
      expect(result.headless).toBe(false);
    });
  });
});
