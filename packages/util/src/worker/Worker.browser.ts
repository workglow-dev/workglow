/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker bindings for the browser. The only reason this is a separate file from
 * {@link ./Worker.node} is that a static `node:worker_threads` import cannot be
 * bundled for a browser — Bun is served by the Node file.
 */

import { globalServiceRegistry } from "../di";
import type { WorkerServerBaseOptions } from "./WorkerServerBase";
import { WORKER_SERVER, WorkerServerBase } from "./WorkerServerBase";

export { WORKER_SERVER };

const Worker = globalThis.Worker;
const parentPort = self;
export { parentPort, Worker };

export class WorkerServer extends WorkerServerBase {
  constructor(options?: WorkerServerBaseOptions) {
    // A worker scope's own `postMessage` sends to the parent, which is what the
    // base class defaults to; naming it here keeps the two platform files
    // symmetrical about where messages go out.
    super({ ...options, post: (message, transfer) => self.postMessage(message, transfer as any) });
    parentPort?.addEventListener("message", async (event) => {
      const msg = {
        type: event.type,
        data: event.data,
      };
      await this.handleMessage(msg);
    });
  }
}

globalServiceRegistry.register(WORKER_SERVER, () => new WorkerServer(), true);
