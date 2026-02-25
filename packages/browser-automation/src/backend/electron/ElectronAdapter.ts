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
import { loadElectron } from "./loadElectron";

// Use `any` for Electron types since it's an optional peer dependency
// and may not be installed at compile time.
type ElectronBrowserWindow = any;

/**
 * Electron backend adapter.
 *
 * Creates runtime sessions backed by Electron BrowserWindows.
 * Security: nodeIntegration is always disabled, contextIsolation is always enabled.
 * Partition persistence follows Electron semantics: "persist:" prefix = persistent, otherwise in-memory.
 */
export class ElectronAdapter implements IBrowserBackendAdapter {
  async createSession(session: BrowserSessionState): Promise<IBrowserRuntimeSession> {
    const electron = await loadElectron();
    const config = session.config;

    // Determine partition for session isolation
    let partition: string | undefined;
    if (config.persistence?.kind === "electronPartition") {
      partition = config.persistence.partition;
    }

    const win = new (electron as any).BrowserWindow({
      show: config.headless === false,
      width: config.viewport?.width ?? 1280,
      height: config.viewport?.height ?? 720,
      webPreferences: {
        // Security: always enforce these
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition,
      },
    });

    if (config.userAgent) {
      win.webContents.setUserAgent(config.userAgent);
    }

    return new ElectronRuntimeSession(win);
  }
}

// ========================================================================
// Electron Runtime Session
// ========================================================================

class ElectronRuntimeSession implements IBrowserRuntimeSession {
  readonly backend = "electron";
  private win: ElectronBrowserWindow;
  private closed = false;

  constructor(win: ElectronBrowserWindow) {
    this.win = win;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.win.destroy();
    } catch {
      // Swallow errors
    }
  }

  async navigate(
    url: string,
    opts: { timeoutMs: number; waitUntil: string }
  ): Promise<{ url: string; title: string; status?: number; ok?: boolean }> {
    await this.win.loadURL(url);

    // Wait for the page to finish loading
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Navigation timeout")), opts.timeoutMs);
      this.win.webContents.once("did-finish-load", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.win.webContents.once("did-fail-load", (_e: unknown, code: unknown, desc: unknown) => {
        clearTimeout(timeout);
        reject(new Error(`Navigation failed: ${desc} (${code})`));
      });
    });

    const title = this.win.getTitle();
    const currentUrl = this.win.webContents.getURL();

    return { url: currentUrl, title };
  }

  async click(
    locator: LocatorSpec,
    opts: { timeoutMs: number; button?: "left" | "right" | "middle"; clickCount?: number }
  ): Promise<void> {
    const script = this.buildLocatorScript(locator, "click");
    await this.executeJs(script, opts.timeoutMs);
  }

  async type(
    locator: LocatorSpec,
    text: string,
    opts: { timeoutMs: number; clear?: boolean; delayMs?: number }
  ): Promise<void> {
    const escapedText = JSON.stringify(text);
    const clear = opts.clear ? "true" : "false";
    const script = this.buildLocatorScript(
      locator,
      "type",
      `{ text: ${escapedText}, clear: ${clear} }`
    );
    await this.executeJs(script, opts.timeoutMs);
  }

  async extract(spec: ExtractSpec, opts: { timeoutMs: number }): Promise<JSONValue> {
    const locatorJs = spec.locator ? this.buildQuerySelector(spec.locator) : `document.body`;

    let script: string;
    switch (spec.kind) {
      case "text":
        script = `(${locatorJs}).innerText`;
        break;
      case "innerHTML":
        script = `(${locatorJs}).innerHTML`;
        break;
      case "textContent":
        script = `(${locatorJs}).textContent`;
        break;
      case "attribute":
        script = `(${locatorJs}).getAttribute(${JSON.stringify(spec.attribute)})`;
        break;
      case "value":
        script = `(${locatorJs}).value`;
        break;
      case "allText":
        script = `Array.from(document.querySelectorAll(${JSON.stringify(this.locatorToCss(spec.locator))}), el => el.innerText)`;
        break;
      case "table":
        script = `(() => { const t = (${locatorJs}).closest("table") || (${locatorJs}).querySelector("table") || (${locatorJs}); return Array.from(t.querySelectorAll("tr"), row => Array.from(row.querySelectorAll("th, td"), c => c.innerText.trim())); })()`;
        break;
      default:
        throw new Error(`Unknown extract kind: ${spec.kind}`);
    }

    return (await this.executeJs(script, opts.timeoutMs)) as JSONValue;
  }

  async wait(spec: WaitSpec, opts: { timeoutMs: number }): Promise<void> {
    switch (spec.mode) {
      case "timeout":
        await new Promise<void>((resolve) => setTimeout(resolve, opts.timeoutMs));
        break;
      case "locator": {
        if (!spec.locator) throw new Error("locator is required for wait mode 'locator'");
        const css = this.locatorToCss(spec.locator);
        await this.waitForSelector(css, opts.timeoutMs);
        break;
      }
      case "url":
        if (!spec.urlPattern) throw new Error("urlPattern is required for wait mode 'url'");
        await this.waitForUrl(spec.urlPattern, opts.timeoutMs);
        break;
      case "loadState":
        // For Electron, we approximate load state
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Wait timeout")), opts.timeoutMs);
          this.win.webContents.once("did-finish-load", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
        break;
      default:
        throw new Error(`Unknown wait mode: ${spec.mode}`);
    }
  }

  async screenshot(
    opts: ScreenshotSpec & { timeoutMs: number }
  ): Promise<{ mime: "image/png" | "image/jpeg"; bytes: Uint8Array }> {
    const image = await this.win.webContents.capturePage();
    const format = opts.format ?? "png";
    const buffer = format === "jpeg" ? image.toJPEG(opts.quality ?? 80) : image.toPNG();
    return {
      mime: format === "jpeg" ? "image/jpeg" : "image/png",
      bytes: new Uint8Array(buffer),
    };
  }

  async evaluate(script: string, opts: { timeoutMs: number }): Promise<JSONValue> {
    const result = await this.executeJs(script, opts.timeoutMs);
    return JSON.parse(JSON.stringify(result ?? null));
  }

  // ========================================================================
  // Private helpers
  // ========================================================================

  private async executeJs(script: string, timeoutMs: number): Promise<unknown> {
    return Promise.race([
      this.win.webContents.executeJavaScript(script),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Script execution timeout")), timeoutMs)
      ),
    ]);
  }

  private buildQuerySelector(locator?: LocatorSpec): string {
    if (!locator) return "document.body";
    const css = this.locatorToCss(locator);
    const nth = locator.nth;
    if (nth !== undefined) {
      return `document.querySelectorAll(${JSON.stringify(css)})[${nth}]`;
    }
    return `document.querySelector(${JSON.stringify(css)})`;
  }

  private locatorToCss(locator?: LocatorSpec): string {
    if (!locator) return "body";
    switch (locator.kind) {
      case "role":
        return `[role="${locator.role}"]`;
      case "label":
        return `[aria-label="${locator.text}"]`;
      case "testid":
        return `[data-testid="${locator.testId}"]`;
      case "text":
        return "*";
      case "css":
        return locator.selector;
      case "xpath":
        return "*";
      default:
        return "*";
    }
  }

  private buildLocatorScript(locator: LocatorSpec, action: string, argsJson?: string): string {
    const qs = this.buildQuerySelector(locator);
    switch (action) {
      case "click":
        return `(${qs}).click()`;
      case "type": {
        return `(() => { const el = ${qs}; ${argsJson ? `const args = ${argsJson}; if (args.clear) el.value = "";` : ""} el.focus(); el.value = ${argsJson ? `args.text` : `""`}; el.dispatchEvent(new Event("input", { bubbles: true })); })()`;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  private async waitForSelector(css: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    const interval = 100;
    while (Date.now() - start < timeoutMs) {
      const found = await this.executeJs(
        `!!document.querySelector(${JSON.stringify(css)})`,
        timeoutMs
      );
      if (found) return;
      await new Promise<void>((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`Timeout waiting for selector: ${css}`);
  }

  private async waitForUrl(pattern: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    const interval = 100;
    while (Date.now() - start < timeoutMs) {
      const url = this.win.webContents.getURL();
      if (url.includes(pattern) || new RegExp(pattern).test(url)) return;
      await new Promise<void>((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`Timeout waiting for URL matching: ${pattern}`);
  }
}
