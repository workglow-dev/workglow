/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  QueuedAiProvider,
  type AiProviderReactiveRunFn,
  type AiProviderRunFn,
  type AiProviderStreamFn,
} from "@workglow/ai";
import { WEB_BROWSER } from "./common/WebBrowser_Constants";
import type { WebBrowserModelConfig } from "./common/WebBrowser_ModelSchema";

/** Main-thread registration (inline or worker-backed); creates the default job queue. */
export class WebBrowserQueuedProvider extends QueuedAiProvider<WebBrowserModelConfig> {
  readonly name = WEB_BROWSER;
  readonly displayName = "Chrome Built-in AI";
  readonly isLocal = true;
  readonly supportsBrowser = true;

  readonly taskTypes = [
    "ModelInfoTask",
    "TextSummaryTask",
    "TextLanguageDetectionTask",
    "TextTranslationTask",
    "TextGenerationTask",
    "TextRewriterTask",
    "ModelSearchTask",
  ] as const;

  constructor(
    tasks?: Record<string, AiProviderRunFn<any, any, WebBrowserModelConfig>>,
    streamTasks?: Record<string, AiProviderStreamFn<any, any, WebBrowserModelConfig>>,
    reactiveTasks?: Record<string, AiProviderReactiveRunFn<any, any, WebBrowserModelConfig>>
  ) {
    super(tasks, streamTasks, reactiveTasks);
  }
}
