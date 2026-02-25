/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "bun:test";
import {
  getBrowserEnvelope,
  setBrowserEnvelope,
  clearBrowserEnvelope,
  setBrowserLast,
  resolveOrCreateBrowserEnvelope,
} from "../core/context";
import type { BrowserEnvelope, WorkflowContext } from "../core/context";

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
});
