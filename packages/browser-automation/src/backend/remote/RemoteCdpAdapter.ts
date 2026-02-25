/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserSessionState } from "../../core/context";
import type { IBrowserBackendAdapter, IBrowserRuntimeSession } from "../../core/types";
import { loadPlaywright } from "../playwright/loadPlaywright";

type PlaywrightBrowser = import("playwright").Browser;

/**
 * Remote CDP backend adapter.
 *
 * Connects to a remote browser via Chrome DevTools Protocol (CDP).
 * Supports providers like Browserless, BrightData, and Browserbase.
 */
export class RemoteCdpAdapter implements IBrowserBackendAdapter {
  async createSession(session: BrowserSessionState): Promise<IBrowserRuntimeSession> {
    const pw = await loadPlaywright();
    const config = session.config;
    const endpoint = config.remoteCdp?.endpoint;

    if (!endpoint) {
      throw new Error("Remote CDP endpoint is required. Set config.remoteCdp.endpoint.");
    }

    const browser: PlaywrightBrowser = await pw.chromium.connectOverCDP(endpoint);
    const contexts = browser.contexts();
    const context =
      contexts.length > 0
        ? contexts[0]
        : await browser.newContext({
            viewport: config.viewport ?? null,
            userAgent: config.userAgent,
          });
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    return new RemoteCdpRuntimeSession(browser, context, page);
  }
}

// ========================================================================
// Remote CDP Runtime Session
// ========================================================================

import type { ExtractSpec, ScreenshotSpec, WaitSpec } from "../../core/types";
import type { JSONValue } from "../../core/json";
import type { LocatorSpec } from "../../core/locator";

type PlaywrightBrowserContext = import("playwright").BrowserContext;
type PlaywrightPage = import("playwright").Page;
type PlaywrightLocator = import("playwright").Locator;

class RemoteCdpRuntimeSession implements IBrowserRuntimeSession {
  readonly backend = "remote-playwright-cdp";
  private browser: PlaywrightBrowser;
  private context: PlaywrightBrowserContext;
  private page: PlaywrightPage;
  private closed = false;

  constructor(browser: PlaywrightBrowser, context: PlaywrightBrowserContext, page: PlaywrightPage) {
    this.browser = browser;
    this.context = context;
    this.page = page;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.browser.close();
    } catch {
      // Swallow close errors
    }
  }

  async navigate(
    url: string,
    opts: { timeoutMs: number; waitUntil: string }
  ): Promise<{ url: string; title: string; status?: number; ok?: boolean }> {
    const response = await this.page.goto(url, {
      timeout: opts.timeoutMs,
      waitUntil: opts.waitUntil as "load" | "domcontentloaded" | "networkidle" | "commit",
    });
    const title = await this.page.title();
    return {
      url: this.page.url(),
      title,
      status: response?.status(),
      ok: response?.ok(),
    };
  }

  async click(
    locator: LocatorSpec,
    opts: { timeoutMs: number; button?: "left" | "right" | "middle"; clickCount?: number }
  ): Promise<void> {
    const loc = this.resolveLocator(locator);
    await loc.click({ timeout: opts.timeoutMs, button: opts.button, clickCount: opts.clickCount });
  }

  async type(
    locator: LocatorSpec,
    text: string,
    opts: { timeoutMs: number; clear?: boolean; delayMs?: number }
  ): Promise<void> {
    const loc = this.resolveLocator(locator);
    if (opts.clear) await loc.clear({ timeout: opts.timeoutMs });
    await loc.fill(text, { timeout: opts.timeoutMs });
  }

  async extract(spec: ExtractSpec, opts: { timeoutMs: number }): Promise<JSONValue> {
    const loc = spec.locator ? this.resolveLocator(spec.locator) : this.page.locator("body");

    switch (spec.kind) {
      case "text":
        return await loc.innerText({ timeout: opts.timeoutMs });
      case "innerHTML":
        return await loc.innerHTML({ timeout: opts.timeoutMs });
      case "textContent":
        return (await loc.textContent({ timeout: opts.timeoutMs })) ?? null;
      case "attribute":
        if (!spec.attribute) throw new Error("attribute name is required");
        return (await loc.getAttribute(spec.attribute, { timeout: opts.timeoutMs })) ?? null;
      case "value":
        return await loc.inputValue({ timeout: opts.timeoutMs });
      case "allText": {
        const elements = await loc.all();
        return Promise.all(elements.map((el) => el.innerText({ timeout: opts.timeoutMs })));
      }
      case "table":
        return await loc.evaluate((el) => {
          const table = el.closest("table") ?? el.querySelector("table") ?? el;
          const rows = table.querySelectorAll("tr");
          return Array.from(rows, (row) =>
            Array.from(row.querySelectorAll("th, td"), (c) => (c as HTMLElement).innerText.trim())
          );
        });
      default:
        throw new Error(`Unknown extract kind: ${spec.kind}`);
    }
  }

  async wait(spec: WaitSpec, opts: { timeoutMs: number }): Promise<void> {
    switch (spec.mode) {
      case "timeout":
        await new Promise<void>((r) => setTimeout(r, opts.timeoutMs));
        break;
      case "locator":
        if (!spec.locator) throw new Error("locator required");
        await this.resolveLocator(spec.locator).waitFor({
          state: spec.state ?? "visible",
          timeout: opts.timeoutMs,
        });
        break;
      case "url":
        if (!spec.urlPattern) throw new Error("urlPattern required");
        await this.page.waitForURL(spec.urlPattern, { timeout: opts.timeoutMs });
        break;
      case "loadState":
        await this.page.waitForLoadState(spec.loadState ?? "load", { timeout: opts.timeoutMs });
        break;
    }
  }

  async screenshot(
    opts: ScreenshotSpec & { timeoutMs: number }
  ): Promise<{ mime: "image/png" | "image/jpeg"; bytes: Uint8Array }> {
    const format = opts.format ?? "png";
    let buffer: Buffer;
    if (opts.locator) {
      buffer = await this.resolveLocator(opts.locator).screenshot({
        type: format,
        timeout: opts.timeoutMs,
      });
    } else {
      buffer = await this.page.screenshot({
        type: format,
        fullPage: opts.fullPage,
        timeout: opts.timeoutMs,
      });
    }
    return { mime: format === "jpeg" ? "image/jpeg" : "image/png", bytes: new Uint8Array(buffer) };
  }

  async evaluate(script: string, opts: { timeoutMs: number }): Promise<JSONValue> {
    const result = await this.page.evaluate(script);
    return JSON.parse(JSON.stringify(result ?? null));
  }

  private resolveLocator(spec: LocatorSpec): PlaywrightLocator {
    let loc: PlaywrightLocator;
    switch (spec.kind) {
      case "role":
        loc = this.page.getByRole(spec.role as Parameters<PlaywrightPage["getByRole"]>[0], {
          name: spec.name,
          exact: spec.exact,
        });
        break;
      case "label":
        loc = this.page.getByLabel(spec.text, { exact: spec.exact });
        break;
      case "text":
        loc = this.page.getByText(spec.text, { exact: spec.exact });
        break;
      case "testid":
        loc = this.page.getByTestId(spec.testId);
        break;
      case "css":
        loc = this.page.locator(spec.selector);
        break;
      case "xpath":
        loc = this.page.locator(`xpath=${spec.selector}`);
        break;
      default:
        throw new Error(`Unknown locator kind`);
    }
    if (spec.nth !== undefined) loc = loc.nth(spec.nth);
    return loc;
  }
}
