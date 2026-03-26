const Worker = globalThis.Worker;
const parentPort = self;
export { Worker, parentPort };

import { WorkerServerBase, WORKER_SERVER } from "./WorkerServerBase";
import { globalServiceRegistry } from "../di";
export { WORKER_SERVER };
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

globalServiceRegistry.register(WORKER_SERVER, () => new WorkerServer(), true);
