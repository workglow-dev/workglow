/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AiProvider,
  type AiProviderReactiveRunFn,
  type AiProviderRunFn,
  type AiProviderStreamFn,
} from "@workglow/ai";
import { WEB_BROWSER } from "./common/WebBrowser_Constants";
import type { WebBrowserModelConfig } from "./common/WebBrowser_ModelSchema";

/**
 * AI provider for Chrome Built-in AI APIs (Gemini Nano on-device).
 *
 * Browser-only provider — no external SDK needed, the APIs are browser globals.
 *
 * Supports summarization, language detection, translation, text generation
 * (Prompt API), and text rewriting via Chrome's Built-in AI APIs.
 *
 * Task run functions are injected via the constructor so that the provider
 * class itself has no runtime dependency on Chrome globals (it can be
 * instantiated on the main thread in worker mode without errors).
 *
 * @example
 * ```typescript
 * // Worker mode (main thread) -- lightweight, no heavy imports:
 * await new WebBrowserProvider().register({
 *   mode: "worker",
 *   worker: new Worker(new URL("./worker_web_browser.ts", import.meta.url), { type: "module" }),
 * });
 *
 * // Inline mode -- caller provides the tasks:
 * import { WEB_BROWSER_TASKS, WEB_BROWSER_STREAM_TASKS } from "@workglow/ai-provider/web-browser";
 * await new WebBrowserProvider(WEB_BROWSER_TASKS, WEB_BROWSER_STREAM_TASKS).register({ mode: "inline" });
 * ```
 */
export class WebBrowserProvider extends AiProvider<WebBrowserModelConfig> {
  readonly name = WEB_BROWSER;
  readonly isLocal = true;
  readonly supportsBrowser = true;

  readonly taskTypes = [
    "ModelInfoTask",
    "TextSummaryTask",
    "TextLanguageDetectionTask",
    "TextTranslationTask",
    "TextGenerationTask",
    "TextRewriterTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, WebBrowserModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, WebBrowserModelConfig>>,
    reactiveTasks?: Record<string, AiProviderReactiveRunFn<any, any, WebBrowserModelConfig>>
  ) {
    super(tasks, streamTasks, reactiveTasks);
  }
}
