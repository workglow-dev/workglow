const Worker = globalThis.Worker;
const parentPort = self;
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
