/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, globalServiceRegistry } from "../di";
import { getLogger } from "../logging";

export class WorkerManager {
  private workers: Map<string, Worker> = new Map();
  private readyWorkers: Map<string, Promise<void>> = new Map();
  /** Function names registered on each worker, populated from the ready message. */
  private workerFunctions: Map<string, Set<string>> = new Map();
  private workerStreamFunctions: Map<string, Set<string>> = new Map();
  private workerReactiveFunctions: Map<string, Set<string>> = new Map();
  /** Pending lazy factories (worker not yet constructed). */
  private lazyFactories: Map<string, () => Worker> = new Map();
  /** Single-flight init promise per name (lazy path). */
  private lazyInitPromises: Map<string, Promise<void>> = new Map();

  registerWorker(name: string, workerOrFactory: Worker | (() => Worker)): void {
    if (this.workers.has(name)) {
      throw new Error(`Worker ${name} is already registered.`);
    }
    if (this.lazyFactories.has(name)) {
      throw new Error(`Worker ${name} is already registered.`);
    }
    if (typeof workerOrFactory === "function") {
      this.lazyFactories.set(name, workerOrFactory);
    } else {
      this.attachWorkerInstance(name, workerOrFactory);
    }
  }

  private attachWorkerInstance(name: string, worker: Worker): void {
    this.workers.set(name, worker);
    worker.addEventListener("error", (event) => {
      console.error("Worker Error:", event.message, "at", event.filename, "line:", event.lineno);
    });
    worker.addEventListener("messageerror", (event) => {
      console.error("Worker message error:", event);
    });

    const readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.removeEventListener("message", handleReady);
        worker.removeEventListener("error", handleError);
        reject(new Error(`Worker "${name}" did not become ready within 10s`));
      }, 10_000);

      const handleError = (event: ErrorEvent) => {
        clearTimeout(timeout);
        worker.removeEventListener("message", handleReady);
        worker.removeEventListener("error", handleError);
        reject(
          new Error(`Worker "${name}" initialization error: ${event.message ?? "unknown error"}`)
        );
      };

      const handleReady = (event: MessageEvent) => {
        if (event.data?.type === "ready") {
          clearTimeout(timeout);
          worker.removeEventListener("message", handleReady);
          worker.removeEventListener("error", handleError);
          this.workerFunctions.set(name, new Set(event.data.functions ?? []));
          this.workerStreamFunctions.set(name, new Set(event.data.streamFunctions ?? []));
          this.workerReactiveFunctions.set(name, new Set(event.data.reactiveFunctions ?? []));
          resolve();
        }
      };

      worker.addEventListener("message", handleReady);
      worker.addEventListener("error", handleError);
    });

    this.readyWorkers.set(name, readyPromise);
  }

  /**
   * Ensures a lazy worker is constructed and ready. No-op if already
   * registered eagerly.
   */
  private async ensureWorkerReady(name: string): Promise<void> {
    if (this.workers.has(name)) {
      await this.readyWorkers.get(name)!;
      return;
    }
    const factory = this.lazyFactories.get(name);
    if (!factory) {
      throw new Error(`Worker ${name} not found.`);
    }
    let init = this.lazyInitPromises.get(name);
    if (!init) {
      init = (async () => {
        const f = this.lazyFactories.get(name)!;
        this.lazyFactories.delete(name);
        const worker = f();
        this.attachWorkerInstance(name, worker);
      })();
      this.lazyInitPromises.set(name, init);
    }
    await init;
    await this.readyWorkers.get(name)!;
    this.lazyInitPromises.delete(name);
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
    await this.ensureWorkerReady(workerName);
    const worker = this.workers.get(workerName);
    if (!worker) throw new Error(`Worker ${workerName} not found.`);
    await this.readyWorkers.get(workerName);

    const knownFunctions = this.workerFunctions.get(workerName);
    if (knownFunctions && !knownFunctions.has(functionName)) {
      throw new Error(`Function "${functionName}" is not registered on worker "${workerName}".`);
    }

    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();

      const handleMessage = (event: MessageEvent) => {
        const { id, type, data } = event.data;
        if (id !== requestId) return;
        if (type === "progress" && options?.onProgress) {
          options.onProgress(data.progress, data.message, data.details);
          getLogger().debug(
            `Worker ${workerName} function ${functionName} progress: ${data.progress}, `,
            { data }
          );
        } else if (type === "complete") {
          cleanup();
          getLogger().debug(`Worker ${workerName} function ${functionName} complete.`, { data });
          resolve(data);
        } else if (type === "error") {
          cleanup();
          getLogger().debug(`Worker ${workerName} function ${functionName} error.`, { data });
          const err =
            typeof data === "object" && data !== null
              ? Object.assign(new Error(data.message ?? String(data)), {
                  name: data.name ?? "Error",
                })
              : new Error(String(data));
          reject(err);
        }
      };

      const handleAbort = () => {
        worker.postMessage({ id: requestId, type: "abort" });
        getLogger().info(`Worker ${workerName} function ${functionName} aborted.`);
      };

      const cleanup = () => {
        worker.removeEventListener("message", handleMessage);
        options?.signal?.removeEventListener("abort", handleAbort);
      };

      worker.addEventListener("message", handleMessage);

      if (options?.signal) {
        options.signal.addEventListener("abort", handleAbort, { once: true });
      }

      // Note: We intentionally do NOT transfer TypedArrays from the main thread to the worker.
      // Transferring detaches the buffers on the main thread, which breaks downstream tasks
      // that still need those TypedArrays (e.g., the embedding vectors flowing through the
      // task graph). Workers send results back with transferables (zero-copy), but the
      // main thread always clones data going to workers to preserve its own references.
      const message = { id: requestId, type: "call", functionName, args };
      worker.postMessage(message);
      getLogger().info(`Worker ${workerName} function ${functionName} called.`);
    });
  }

  /**
   * Call a reactive function on a worker. Returns undefined (rather than throwing)
   * if the worker has no reactive function registered for the given name, so callers
   * can treat the result as an optional preview.
   *
   * @param workerName - Registered worker name
   * @param functionName - Name of the reactive function registered on the worker
   * @param args - Arguments to pass: [input, output, model]
   * @returns The reactive result, or undefined if not registered / on error
   */
  async callWorkerReactiveFunction<T>(
    workerName: string,
    functionName: string,
    args: any[]
  ): Promise<T | undefined> {
    await this.ensureWorkerReady(workerName);
    const worker = this.workers.get(workerName);
    if (!worker) return undefined;
    await this.readyWorkers.get(workerName);

    // Skip the roundtrip if the worker didn't register a reactive function for this name.
    const knownReactive = this.workerReactiveFunctions.get(workerName);
    if (knownReactive && !knownReactive.has(functionName)) return undefined;

    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();

      const handleMessage = (event: MessageEvent) => {
        const { id, type, data } = event.data;
        if (id !== requestId) return;
        if (type === "complete") {
          cleanup();
          resolve(data as T | undefined);
        } else if (type === "error") {
          cleanup();
          resolve(undefined);
        }
      };

      const cleanup = () => {
        worker.removeEventListener("message", handleMessage);
      };

      worker.addEventListener("message", handleMessage);

      const message = { id: requestId, type: "call", functionName, args, reactive: true };
      // Note: No transferables — same reasoning as callWorkerFunction above.
      worker.postMessage(message);
      getLogger().info(`Worker ${workerName} reactive function ${functionName} called.`);
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
    await this.ensureWorkerReady(workerName);
    const worker = this.workers.get(workerName);
    if (!worker) throw new Error(`Worker ${workerName} not found.`);
    await this.readyWorkers.get(workerName);

    // The worker falls back to regular functions for stream calls, so either counts.
    const knownStream = this.workerStreamFunctions.get(workerName);
    const knownFns = this.workerFunctions.get(workerName);
    if (knownStream && knownFns && !knownStream.has(functionName) && !knownFns.has(functionName)) {
      throw new Error(`Function "${functionName}" is not registered on worker "${workerName}".`);
    }

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
      getLogger().info(`Worker ${workerName} stream function ${functionName} aborted.`);
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
    // Note: No transferables — same reasoning as callWorkerFunction above.
    const message = { id: requestId, type: "call", functionName, args, stream: true };
    worker.postMessage(message);
    getLogger().info(`Worker ${workerName} stream function ${functionName} called.`);

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
        getLogger().info(`Worker ${workerName} stream function ${functionName} aborted.`);
      }
      cleanup();
    }
  }
}

export const WORKER_MANAGER = createServiceToken<WorkerManager>("worker.manager");

globalServiceRegistry.register(WORKER_MANAGER, () => new WorkerManager(), true);
