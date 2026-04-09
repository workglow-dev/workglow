/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "../di";

/** Service token for the platform-specific WorkerServer instance. */
export const WORKER_SERVER = createServiceToken<WorkerServerBase>("worker.server");

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
 * WorkerServerBase is a class that handles messages from the main thread to the worker.
 * It is used to register functions that can be called from the main thread.
 * It also handles the transfer of transferables to the main thread.
 */
export class WorkerServerBase {
  constructor() {} // overridden in subclasses

  private functions: Record<string, (...args: any[]) => Promise<any>> = {};
  private streamFunctions: Record<string, (...args: any[]) => AsyncIterable<any>> = {};
  private reactiveFunctions: Record<string, (input: any, output: any, model: any) => Promise<any>> =
    {};

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
    const uniqueTransferables = [...new Set(transferables)];
    // @ts-ignore - Ignore type mismatch between standard Transferable and Bun.Transferable
    postMessage({ id, type: "complete", data: result }, uniqueTransferables);
  };

  private postError = (id: string, error: unknown) => {
    if (this.completedRequests.has(id)) {
      return; // Already responded to this request
    }
    this.completedRequests.add(id);
    let data: { message: string; name: string };
    if (typeof error === "string") {
      data = { message: error, name: "Error" };
    } else if (error instanceof Error) {
      data = { message: error.message, name: error.name };
    } else {
      data = { message: String(error), name: "Error" };
    }
    postMessage({ id, type: "error", data });
  };

  private postStreamChunk = (id: string, event: any) => {
    if (this.completedRequests.has(id)) {
      return;
    }
    postMessage({ id, type: "stream_chunk", data: event });
  };

  /**
   * Send the ready message to the main thread, advertising which functions are
   * registered in each category. Call this after all functions have been registered
   * so WorkerManager can skip unnecessary roundtrips for unregistered calls.
   */
  sendReady() {
    // @ts-ignore
    postMessage({
      type: "ready",
      functions: Object.keys(this.functions),
      streamFunctions: Object.keys(this.streamFunctions),
      reactiveFunctions: Object.keys(this.reactiveFunctions),
    });
  }

  registerFunction(name: string, fn: (...args: any[]) => Promise<any>) {
    this.functions[name] = fn;
  }

  /**
   * Register a reactive function for lightweight preview execution.
   * Reactive functions receive (input, output, model) and return a fast preview
   * without progress tracking or abort signals.
   *
   * @param name - The function name (e.g., task type identifier)
   * @param fn - Async function: (input, output, model) => Promise<output | undefined>
   */
  registerReactiveFunction(
    name: string,
    fn: (input: any, output: any, model: any) => Promise<any>
  ) {
    this.reactiveFunctions[name] = fn;
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
    const { id, type, functionName, args, stream, reactive } = event.data;
    if (type === "abort") {
      return await this.handleAbort(id);
    }
    if (type === "call") {
      if (stream) {
        return await this.handleStreamCall(id, functionName, args);
      }
      if (reactive) {
        return await this.handleReactiveCall(id, functionName, args);
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
      this.scheduleCompletedRequestCleanup(id);
    }
  }

  /**
   * Handle a reactive call. Returns undefined (non-error) if the reactive
   * function is not registered, since not all task types expose a reactive fn.
   */
  async handleReactiveCall(
    id: string,
    functionName: string,
    [input, output, model]: [any, any, any]
  ) {
    if (!(functionName in this.reactiveFunctions)) {
      this.postResult(id, undefined);
      return;
    }
    try {
      const fn = this.reactiveFunctions[functionName];
      const result = await fn(input, output, model);
      this.postResult(id, result);
    } catch (error) {
      this.postError(id, error);
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
    } catch (error) {
      this.postError(id, error);
    } finally {
      this.requestControllers.delete(id);
      this.scheduleCompletedRequestCleanup(id);
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
      } catch (error) {
        this.postError(id, error);
      } finally {
        this.requestControllers.delete(id);
        this.scheduleCompletedRequestCleanup(id);
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
      } catch (error) {
        this.postError(id, error);
      } finally {
        this.requestControllers.delete(id);
        this.scheduleCompletedRequestCleanup(id);
      }
    } else {
      this.postError(id, `Function ${functionName} not found`);
    }
  }

  /**
   * Schedule cleanup of a completed request ID. Uses a 5-second delay to
   * handle late-arriving abort messages, and caps the completed set size
   * to prevent unbounded growth.
   */
  private scheduleCompletedRequestCleanup(id: string): void {
    setTimeout(() => {
      this.completedRequests.delete(id);
    }, 5000);

    // Safety cap: if the set grows too large, clear the oldest entries
    if (this.completedRequests.size > 1000) {
      const iter = this.completedRequests.values();
      for (let i = 0; i < 500; i++) {
        const entry = iter.next();
        if (entry.done) break;
        this.completedRequests.delete(entry.value);
      }
    }
  }
}
