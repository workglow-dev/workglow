/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from "vitest";
import { BunWebViewBackend } from "@workglow/tasks";
import { runGenericBrowserTaskTests } from "./genericBrowserTaskTests";

// Bun.WebView with Chrome backend — skip when Chrome is unavailable.
let bunWebViewAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const WebView = (globalThis as any).Bun?.WebView;
  if (WebView) {
    const wv = new WebView({ headless: true, backend: "chrome", url: "about:blank" });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        wv.close();
        reject();
      }, 10_000);
      wv.onNavigated = () => {
        clearTimeout(timer);
        resolve();
      };
      wv.onNavigationFailed = () => {
        clearTimeout(timer);
        reject();
      };
    });
    wv.close();
    bunWebViewAvailable = true;
  }
} catch {
  // Chrome not installed or Bun.WebView unavailable
}

describe.skipIf(!bunWebViewAvailable)("Browser Tasks (BunWebViewBackend)", () => {
  runGenericBrowserTaskTests(() => new BunWebViewBackend(), { hookTimeout: 30_000 });
});
