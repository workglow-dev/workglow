import { Worker as NodeWorker, isMainThread, parentPort } from "worker_threads";
import type { WorkerOptions } from "worker_threads";
import { pathToFileURL } from "url";
import { URL as NodeURL } from "url";

class WorkerPolyfill extends NodeWorker {
  constructor(scriptUrl: string | NodeURL, options?: WorkerOptions) {
    const resolved: string =
      scriptUrl instanceof NodeURL ? scriptUrl.toString() : pathToFileURL(scriptUrl).toString();
    super(resolved, options);
  }

  addEventListener(event: "message" | "error", listener: (...args: any[]) => void) {
    if (event === "message") this.on("message", listener);
    if (event === "error") this.on("error", listener);
  }

  removeEventListener(event: "message" | "error", listener: (...args: any[]) => void) {
    if (event === "message") this.off("message", listener);
    if (event === "error") this.off("error", listener);
  }
}

const Worker = isMainThread ? WorkerPolyfill : parentPort;
export { Worker, parentPort };

import { WorkerServerBase } from "./WorkerServerBase";
import { createServiceToken, globalServiceRegistry } from "../di";
export class WorkerServer extends WorkerServerBase {
  constructor() {
    parentPort?.addEventListener("message", async (event) => {
      const msg = {
        type: event.type,
        // @ts-ignore - Ignore type mismatch between standard MessageEvent and our message type
        data: event.data,
      };
      await this.handleMessage(msg);
    });
    super();
  }
}

export const WORKER_SERVER = createServiceToken<WorkerServer>("worker.server");

globalServiceRegistry.register(WORKER_SERVER, () => new WorkerServer(), true);
