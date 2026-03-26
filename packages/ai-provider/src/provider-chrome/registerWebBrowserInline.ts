/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { WEB_BROWSER_STREAM_TASKS, WEB_BROWSER_TASKS } from "./common/WebBrowser_JobRunFns";
import { WebBrowserQueuedProvider } from "./WebBrowserQueuedProvider";

export async function registerWebBrowserInline(options?: AiProviderRegisterOptions): Promise<void> {
  await new WebBrowserQueuedProvider(WEB_BROWSER_TASKS, WEB_BROWSER_STREAM_TASKS).register(
    options ?? {}
  );
}
