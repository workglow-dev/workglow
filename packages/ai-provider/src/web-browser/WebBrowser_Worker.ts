/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger, globalServiceRegistry, WORKER_SERVER } from "@workglow/util";
import { WEB_BROWSER_TASKS, WEB_BROWSER_STREAM_TASKS } from "./common/WebBrowser_JobRunFns";
import { WebBrowserProvider } from "./WebBrowserProvider";

export function WEB_BROWSER_WORKER_JOBRUN_REGISTER() {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new WebBrowserProvider(WEB_BROWSER_TASKS, WEB_BROWSER_STREAM_TASKS).registerOnWorkerServer(
    workerServer
  );
  workerServer.sendReady();
  getLogger().info("WEB_BROWSER_WORKER_JOBRUN registered");
}
