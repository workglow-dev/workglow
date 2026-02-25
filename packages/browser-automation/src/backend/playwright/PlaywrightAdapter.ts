/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserSessionState } from "../../core/context";
import type {
  ExtractSpec,
  IBrowserBackendAdapter,
  IBrowserRuntimeSession,
  ScreenshotSpec,
  WaitSpec,
} from "../../core/types";
import type { JSONValue } from "../../core/json";
import type { LocatorSpec } from "../../core/locator";
import { loadPlaywright } from "./loadPlaywright";
import { TaskConfigurationError } from "@workglow/task-graph";

/**
 * Playwright launch option keys blocked for security reasons.
 * These options allow arbitrary code execution or sandbox escape.
 */
export const BLOCKED_LAUNCH_OPTION_KEYS: ReadonlySet<string> = new Set([
  "executablePath", // Points Playwright at an arbitrary host binary (RCE)
  "args", // CLI flags can disable sandbox, load extensions
  "env", // Child-process env vars allow LD_PRELOAD / PATH hijacking
]);

/**
 * Throws TaskConfigurationError if opts contains any blocked launch option key.
 * Called before every Playwright launch() / launchPersistentContext() call.
 */
export function assertSafeLaunchOptions(opts: Record<string, unknown>): void {
  for (const key of BLOCKED_LAUNCH_OPTION_KEYS) {
    if (key in opts) {
      throw new TaskConfigurationError(
        `Playwright launchOptions key "${key}" is not permitted: it could allow arbitrary code execution`
      );
    }
  }
}

type PlaywrightBrowser = import("playwright").Browser;
type PlaywrightBrowserContext = import("playwright").BrowserContext;
type PlaywrightPage = import("playwright").Page;
type PlaywrightLocator = import("playwright").Locator;

/**
 * Playwright backend adapter.
 *
 * Creates runtime sessions backed by Playwright browser contexts.
 * Supports chromium/firefox/webkit and persistent user-data-dir profiles.
 */
export class PlaywrightAdapter implements IBrowserBackendAdapter {
  private browserPool = new Map<string, PlaywrightBrowser>();

  async createSession(session: BrowserSessionState): Promise<IBrowserRuntimeSession> {
    const pw = await loadPlaywright();
    const config = session.config;
    const pwConfig = config.playwright ?? {};
    const browserType = pwConfig.browserType ?? "chromium";
    const headless = config.headless !== false;

    let context: PlaywrightBrowserContext;
    let page: PlaywrightPage;

    if (config.persistence?.kind === "playwrightUserDataDir") {
      // Persistent profile: uses launchPersistentContext, one session per userDataDir
      if (pwConfig.launchOptions) {
        assertSafeLaunchOptions(pwConfig.launchOptions as Record<string, unknown>);
      }
      context = await pw[browserType].launchPersistentContext(config.persistence.userDataDir, {
        headless,
        viewport: config.viewport ?? null,
        userAgent: config.userAgent,
        ...(pwConfig.launchOptions as Record<string, unknown>),
        ...(pwConfig.contextOptions as Record<string, unknown>),
      });
      page = context.pages()[0] ?? (await context.newPage());
    } else {
      // Ephemeral: pool browser instances by (browserType, headless)
      const poolKey = `${browserType}:${headless}`;
      let browser = this.browserPool.get(poolKey);
      if (!browser || !browser.isConnected()) {
        if (pwConfig.launchOptions) {
          assertSafeLaunchOptions(pwConfig.launchOptions as Record<string, unknown>);
        }
        browser = await pw[browserType].launch({
          headless,
          ...(pwConfig.launchOptions as Record<string, unknown>),
        });
        this.browserPool.set(poolKey, browser);
      }

      const ctxOpts: Record<string, unknown> = {
        viewport: config.viewport ?? null,
        userAgent: config.userAgent,
        ...(pwConfig.contextOptions as Record<string, unknown>),
      };
      if (pwConfig.storageState) {
        ctxOpts.storageState = pwConfig.storageState;
      }
      context = await browser.newContext(ctxOpts);
      page = await context.newPage();
    }

    return new PlaywrightRuntimeSession(context, page);
  }

  /**
   * Close all pooled browsers. Called internally during cleanup.
   */
  async closePool(): Promise<void> {
    const browsers = Array.from(this.browserPool.values());
    this.browserPool.clear();
    await Promise.allSettled(browsers.map((b) => b.close()));
  }
}

// ========================================================================
// Playwright Runtime Session
// ========================================================================

class PlaywrightRuntimeSession implements IBrowserRuntimeSession {
  readonly backend = "playwright";
  private context: PlaywrightBrowserContext;
  private page: PlaywrightPage;
  private closed = false;

  constructor(context: PlaywrightBrowserContext, page: PlaywrightPage) {
    this.context = context;
    this.page = page;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.context.close();
    } catch {
      // Swallow close errors (browser may have crashed)
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
    const currentUrl = this.page.url();
    return {
      url: currentUrl,
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
    await loc.click({
      timeout: opts.timeoutMs,
      button: opts.button,
      clickCount: opts.clickCount,
    });
  }

  async type(
    locator: LocatorSpec,
    text: string,
    opts: { timeoutMs: number; clear?: boolean; delayMs?: number }
  ): Promise<void> {
    const loc = this.resolveLocator(locator);
    if (opts.clear) {
      await loc.clear({ timeout: opts.timeoutMs });
    }
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
        if (!spec.attribute) throw new Error("attribute name is required for kind 'attribute'");
        return (await loc.getAttribute(spec.attribute, { timeout: opts.timeoutMs })) ?? null;
      case "value":
        return await loc.inputValue({ timeout: opts.timeoutMs });
      case "allText": {
        const elements = await loc.all();
        const texts: string[] = [];
        for (const el of elements) {
          texts.push(await el.innerText({ timeout: opts.timeoutMs }));
        }
        return texts;
      }
      case "table": {
        return await loc.evaluate((el) => {
          const table = el.closest("table") ?? el.querySelector("table") ?? el;
          return Array.from(table.querySelectorAll("tr"), (row) =>
            Array.from(row.querySelectorAll("th, td"), (c) => (c as HTMLElement).innerText.trim())
          );
        });
      }
      default:
        throw new Error(`Unknown extract kind: ${spec.kind}`);
    }
  }

  async wait(spec: WaitSpec, opts: { timeoutMs: number }): Promise<void> {
    switch (spec.mode) {
      case "timeout":
        await new Promise<void>((resolve) => setTimeout(resolve, opts.timeoutMs));
        break;
      case "locator": {
        if (!spec.locator) throw new Error("locator is required for wait mode 'locator'");
        const loc = this.resolveLocator(spec.locator);
        await loc.waitFor({
          state: spec.state ?? "visible",
          timeout: opts.timeoutMs,
        });
        break;
      }
      case "url":
        if (!spec.urlPattern) throw new Error("urlPattern is required for wait mode 'url'");
        await this.page.waitForURL(spec.urlPattern, { timeout: opts.timeoutMs });
        break;
      case "loadState":
        await this.page.waitForLoadState(spec.loadState ?? "load", {
          timeout: opts.timeoutMs,
        });
        break;
      default:
        throw new Error(`Unknown wait mode: ${spec.mode}`);
    }
  }

  async screenshot(
    opts: ScreenshotSpec & { timeoutMs: number }
  ): Promise<{ mime: "image/png" | "image/jpeg"; bytes: Uint8Array }> {
    const format = opts.format ?? "png";
    const screenshotOpts: Record<string, unknown> = {
      type: format,
      fullPage: opts.fullPage ?? false,
      timeout: opts.timeoutMs,
    };
    if (format === "jpeg" && opts.quality !== undefined) {
      screenshotOpts.quality = opts.quality;
    }

    let buffer: Buffer;
    if (opts.locator) {
      const loc = this.resolveLocator(opts.locator);
      buffer = await loc.screenshot(screenshotOpts);
    } else {
      buffer = await this.page.screenshot(screenshotOpts);
    }

    return {
      mime: format === "jpeg" ? "image/jpeg" : "image/png",
      bytes: new Uint8Array(buffer),
    };
  }

  async evaluate(script: string, opts: { timeoutMs: number }): Promise<JSONValue> {
    const result = await this.page.evaluate(script);
    // Ensure the result is JSON-serializable
    return JSON.parse(JSON.stringify(result ?? null));
  }

  /**
   * Resolve a LocatorSpec to a Playwright Locator.
   * Defaults to user-facing locators (role, label, testid, text) per Playwright best practices.
   */
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
        throw new Error(`Unknown locator kind: ${(spec as LocatorSpec).kind}`);
    }

    if (spec.nth !== undefined) {
      loc = loc.nth(spec.nth);
    }

    return loc;
  }
}
