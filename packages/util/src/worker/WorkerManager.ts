/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, globalServiceRegistry } from "../di";

/**
 * Extracts transferables from an object.
 * @param obj - The object to extract transferables from.
 * @returns An array of transferables.
 */
function extractTransferables(obj: any): Transferable[] {
  const transferables: Transferable[] = [];
  const seen = new WeakSet();

  function findTransferables(value: any) {
    // Avoid infinite recursion
    if (value && typeof value === "object" && seen.has(value)) {
      return;
    }
    if (value && typeof value === "object") {
      seen.add(value);
    }

    // Handle TypedArrays
    if (value instanceof Float32Array || value instanceof Int16Array) {
      transferables.push(value.buffer);
    }
    // Handle other TypedArrays
    else if (
      value instanceof Uint8Array ||
      value instanceof Uint8ClampedArray ||
      value instanceof Int8Array ||
      value instanceof Uint16Array ||
      value instanceof Int32Array ||
      value instanceof Uint32Array ||
      value instanceof Float64Array ||
      value instanceof BigInt64Array ||
      value instanceof BigUint64Array
    ) {
      transferables.push(value.buffer);
    }
    // Handle OffscreenCanvas
    else if (typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas) {
      transferables.push(value);
    }
    // Handle ImageBitmap
    else if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) {
      transferables.push(value);
    }
    // Handle VideoFrame
    else if (typeof VideoFrame !== "undefined" && value instanceof VideoFrame) {
      transferables.push(value);
    }
    // Handle MessagePort
    else if (typeof MessagePort !== "undefined" && value instanceof MessagePort) {
      transferables.push(value);
    }
    // Handle ArrayBuffer
    else if (value instanceof ArrayBuffer) {
      transferables.push(value);
    }
    // Recursively search arrays and objects
    else if (Array.isArray(value)) {
      value.forEach(findTransferables);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(findTransferables);
    }
  }

  findTransferables(obj);
  return transferables;
}

export class WorkerManager {
  private workers: Map<string, Worker> = new Map();
  private readyWorkers: Map<string, Promise<void>> = new Map();

  registerWorker(name: string, worker: Worker) {
    if (this.workers.has(name)) throw new Error(`Worker ${name} is already registered.`);
    this.workers.set(name, worker);

    this.workers.set(name, worker);
    worker.addEventListener("error", (event) => {
      console.error("Worker Error:", event.message, "at", event.filename, "line:", event.lineno);
    });
    worker.addEventListener("messageerror", (event) => {
      console.error("Worker message error:", event);
    });

    const readyPromise = new Promise<void>((resolve) => {
      const handleReady = (event: MessageEvent) => {
        if (event.data?.type === "ready") {
          worker.removeEventListener("message", handleReady);
          resolve();
        }
      };

      worker.addEventListener("message", handleReady);
    });

    this.readyWorkers.set(name, readyPromise);
  }

  getWorker(name: string): Worker {
    const worker = this.workers.get(name);
    if (!worker) throw new Error(`Worker ${name} not found.`);
    return worker;
  }

  async callWorkerFunction<T>(
    workerName: string,
    functionName: string,
    args: any[],
    options?: {
      signal?: AbortSignal;
      onProgress?: (progress: number, message?: string, details?: any) => void;
    }
  ): Promise<T> {
    const worker = this.workers.get(workerName);
    if (!worker) throw new Error(`Worker ${workerName} not found.`);
    await this.readyWorkers.get(workerName);

    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();

      const handleMessage = (event: MessageEvent) => {
        const { id, type, data } = event.data;
        if (id !== requestId) return;
        if (type === "progress" && options?.onProgress) {
          options.onProgress(data.progress, data.message, data.details);
        } else if (type === "complete") {
          cleanup();
          resolve(data);
        } else if (type === "error") {
          cleanup();
          reject(new Error(data));
        }
      };

      const handleAbort = () => {
        worker.postMessage({ id: requestId, type: "abort" });
      };

      const cleanup = () => {
        worker.removeEventListener("message", handleMessage);
        options?.signal?.removeEventListener("abort", handleAbort);
      };

      worker.addEventListener("message", handleMessage);

      if (options?.signal) {
        options.signal.addEventListener("abort", handleAbort, { once: true });
      }

      const message = { id: requestId, type: "call", functionName, args };
      const transferables = extractTransferables(message);
      worker.postMessage(message, transferables);
    });
  }

  /**
   * Call a streaming function on a worker and return an AsyncGenerator that
   * yields each stream chunk sent by the worker. The worker sends `stream_chunk`
   * messages for each yielded event and a `complete` message when the generator
   * finishes. An `error` message from the worker causes the iterator to throw.
   *
   * @param workerName - Registered worker name
   * @param functionName - Name of the stream function registered on the worker
   * @param args - Arguments to pass to the stream function
   * @param options - Optional abort signal
   * @returns AsyncGenerator yielding stream events from the worker
   */
  async *callWorkerStreamFunction<T>(
    workerName: string,
    functionName: string,
    args: any[],
    options?: { signal?: AbortSignal }
  ): AsyncGenerator<T> {
    const worker = this.workers.get(workerName);
    if (!worker) throw new Error(`Worker ${workerName} not found.`);
    await this.readyWorkers.get(workerName);

    const requestId = crypto.randomUUID();

    // Push-queue pattern: messages push items, async generator pulls them
    type QueueItem =
      | { kind: "event"; data: T }
      | { kind: "done" }
      | { kind: "error"; error: Error };

    const queue: QueueItem[] = [];
    let waiting: ((value: void) => void) | null = null;

    const notify = () => {
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve();
      }
    };

    const handleMessage = (event: MessageEvent) => {
      const { id, type, data } = event.data;
      if (id !== requestId) return;

      if (type === "stream_chunk") {
        queue.push({ kind: "event", data });
        notify();
      } else if (type === "complete") {
        queue.push({ kind: "done" });
        notify();
      } else if (type === "error") {
        queue.push({ kind: "error", error: new Error(data) });
        notify();
      }
    };

    const handleAbort = () => {
      worker.postMessage({ id: requestId, type: "abort" });
    };

    const cleanup = () => {
      worker.removeEventListener("message", handleMessage);
      options?.signal?.removeEventListener("abort", handleAbort);
    };

    worker.addEventListener("message", handleMessage);

    if (options?.signal) {
      if (options.signal.aborted) {
        cleanup();
        throw new Error("Operation aborted");
      }
      options.signal.addEventListener("abort", handleAbort, { once: true });
    }

    // Send call message with stream flag
    const message = { id: requestId, type: "call", functionName, args, stream: true };
    const transferables = extractTransferables(message);
    worker.postMessage(message, transferables);

    let completedNormally = false;
    try {
      while (true) {
        while (queue.length > 0) {
          const item = queue.shift()!;
          if (item.kind === "event") {
            yield item.data;
          } else if (item.kind === "done") {
            completedNormally = true;
            return;
          } else if (item.kind === "error") {
            completedNormally = true;
            throw item.error;
          }
        }

        // Wait for the next message to arrive
        await new Promise<void>((resolve) => {
          waiting = resolve;
        });
      }
    } finally {
      // If the consumer stopped iterating early (break/return), notify
      // the worker to abort so it doesn't continue generating tokens.
      if (!completedNormally) {
        worker.postMessage({ id: requestId, type: "abort" });
      }
      cleanup();
    }
  }
}

export const WORKER_MANAGER = createServiceToken<WorkerManager>("worker.manager");

globalServiceRegistry.register(WORKER_MANAGER, () => new WorkerManager(), true);
