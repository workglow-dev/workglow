/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parentPort } from "@workglow/util";
import { createServiceToken, globalServiceRegistry } from "../di";

/**
 * Extracts transferables from an object.
 * @param obj - The object to extract transferables from.
 * @returns An array of transferables.
 */
function extractTransferables(obj: any) {
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

/**
 * WorkerServer is a class that handles messages from the main thread to the worker.
 * It is used to register functions that can be called from the main thread.
 * It also handles the transfer of transferables to the main thread.
 */
export class WorkerServer {
  constructor() {
    parentPort?.addEventListener("message", async (event) => {
      const msg = {
        type: event.type,
        // @ts-ignore - Ignore type mismatch between standard MessageEvent and our message type
        data: event.data,
      };
      await this.handleMessage(msg);
    });
  }

  private functions: Record<string, (...args: any[]) => Promise<any>> = {};
  private streamFunctions: Record<string, (...args: any[]) => AsyncIterable<any>> = {};

  // Keep track of each request's AbortController
  private requestControllers = new Map<string, AbortController>();
  // Keep track of requests that have already been responded to
  private completedRequests = new Set<string>();

  private postResult = (id: string, result: any) => {
    if (this.completedRequests.has(id)) {
      return; // Already responded to this request
    }
    this.completedRequests.add(id);
    const transferables = extractTransferables(result);
    // @ts-ignore - Ignore type mismatch between standard Transferable and Bun.Transferable
    postMessage({ id, type: "complete", data: result }, transferables);
  };

  private postError = (id: string, errorMessage: string) => {
    if (this.completedRequests.has(id)) {
      return; // Already responded to this request
    }
    this.completedRequests.add(id);
    postMessage({ id, type: "error", data: errorMessage });
  };

  private postStreamChunk = (id: string, event: any) => {
    if (this.completedRequests.has(id)) {
      return;
    }
    postMessage({ id, type: "stream_chunk", data: event });
  };

  registerFunction(name: string, fn: (...args: any[]) => Promise<any>) {
    this.functions[name] = fn;
  }

  /**
   * Register an async generator function for streaming execution.
   * When called via the worker protocol with `stream: true`, the server
   * iterates the generator and sends each yielded value as a `stream_chunk`
   * message, followed by a `complete` message when the generator finishes.
   *
   * @param name - The function name (e.g., task type identifier)
   * @param fn - Async generator function: (input, model, signal) => AsyncIterable
   */
  registerStreamFunction(name: string, fn: (...args: any[]) => AsyncIterable<any>) {
    this.streamFunctions[name] = fn;
  }

  // Handle messages from the main thread
  async handleMessage(event: { type: string; data: any }) {
    const { id, type, functionName, args, stream } = event.data;
    if (type === "abort") {
      return await this.handleAbort(id);
    }
    if (type === "call") {
      if (stream) {
        return await this.handleStreamCall(id, functionName, args);
      }
      return await this.handleCall(id, functionName, args);
    }
  }

  async handleAbort(id: string) {
    if (this.requestControllers.has(id)) {
      const controller = this.requestControllers.get(id);
      controller?.abort();
      this.requestControllers.delete(id);
      // Send error response back to main thread so the promise rejects
      this.postError(id, "Operation aborted");
    }
  }

  async handleCall(id: string, functionName: string, [input, model]: [any, any]) {
    if (!(functionName in this.functions)) {
      this.postError(id, `Function ${functionName} not found`);
      return;
    }

    try {
      const abortController = new AbortController();
      this.requestControllers.set(id, abortController);

      const fn = this.functions[functionName];
      const postProgress = (progress: number, message?: string, details?: any) => {
        // Don't send progress updates after the request is completed/aborted
        if (!this.completedRequests.has(id)) {
          postMessage({ id, type: "progress", data: { progress, message, details } });
        }
      };
      const result = await fn(input, model, postProgress, abortController.signal);
      this.postResult(id, result);
    } catch (error: any) {
      this.postError(id, error.message);
    } finally {
      this.requestControllers.delete(id);
      // Clean up completed requests set after a delay to handle any race conditions
      // where abort message might arrive shortly after completion
      setTimeout(() => {
        this.completedRequests.delete(id);
      }, 1000);
    }
  }

  /**
   * Handle a streaming call. If a stream function is registered for the given name,
   * iterate it and send each yielded event as a `stream_chunk` message. If only a
   * regular function is registered, run it and wrap the result as a single `finish`
   * stream event (graceful fallback for providers that don't implement streaming).
   */
  async handleStreamCall(id: string, functionName: string, [input, model]: [any, any]) {
    if (functionName in this.streamFunctions) {
      try {
        const abortController = new AbortController();
        this.requestControllers.set(id, abortController);

        const fn = this.streamFunctions[functionName];
        const iterable = fn(input, model, abortController.signal);

        for await (const event of iterable) {
          if (this.completedRequests.has(id)) break;
          this.postStreamChunk(id, event);
        }

        this.postResult(id, undefined);
      } catch (error: any) {
        this.postError(id, error.message);
      } finally {
        this.requestControllers.delete(id);
        setTimeout(() => {
          this.completedRequests.delete(id);
        }, 1000);
      }
    } else if (functionName in this.functions) {
      // Fallback: run regular function and wrap result as a finish stream event
      try {
        const abortController = new AbortController();
        this.requestControllers.set(id, abortController);

        const fn = this.functions[functionName];
        const noopProgress = () => {};
        const result = await fn(input, model, noopProgress, abortController.signal);

        this.postStreamChunk(id, { type: "finish", data: result });
        this.postResult(id, undefined);
      } catch (error: any) {
        this.postError(id, error.message);
      } finally {
        this.requestControllers.delete(id);
        setTimeout(() => {
          this.completedRequests.delete(id);
        }, 1000);
      }
    } else {
      this.postError(id, `Function ${functionName} not found`);
    }
  }
}

export const WORKER_SERVER = createServiceToken<WorkerServer>("worker.server");

globalServiceRegistry.register(WORKER_SERVER, () => new WorkerServer(), true);
