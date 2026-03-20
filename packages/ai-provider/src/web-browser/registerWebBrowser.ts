/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiProviderRegisterOptions } from "@workglow/ai";
import { getLogger, globalServiceRegistry, WORKER_SERVER } from "@workglow/util";
import { WEB_BROWSER_STREAM_TASKS, WEB_BROWSER_TASKS } from "./common/WebBrowser_JobRunFns";
import { WebBrowserProvider } from "./WebBrowserProvider";

export async function registerWebBrowserInline(options?: AiProviderRegisterOptions): Promise<void> {
  await new WebBrowserProvider(WEB_BROWSER_TASKS, WEB_BROWSER_STREAM_TASKS).register(options ?? {});
}

export async function registerWebBrowser(
  options: AiProviderRegisterOptions & {
    worker: Worker | (() => Worker);
  }
): Promise<void> {
  await new WebBrowserProvider().register(options);
}

export function registerWebBrowserWorker(): void {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new WebBrowserProvider(WEB_BROWSER_TASKS, WEB_BROWSER_STREAM_TASKS).registerOnWorkerServer(
    workerServer
  );
  workerServer.sendReady();
  getLogger().info("Web browser worker job run functions registered");
}
