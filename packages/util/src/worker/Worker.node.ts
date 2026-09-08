/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker bindings for every runtime that speaks `node:worker_threads` — Node
 * and Bun both. Bun implements worker threads over the same primitive as its
 * web `Worker`, so a thread spawned either way is reachable through
 * `parentPort` here; there is no Bun-specific build.
 *
 * Only the browser needs its own file ({@link ./Worker.browser}), because a
 * static `node:worker_threads` import cannot be bundled for it.
 */

// Unprefixed on purpose. The root tsconfig sets `types: ["@types/bun"]` and
// `@types/node` is not hoisted, so `node:worker_threads` resolves to Bun's
// web-shaped declaration — a `Worker` with no `on`/`off` and a `postMessage`
// typed for `StructuredSerializeOptions`. The bare specifier resolves to
// `@types/node`, which is the API this file is actually written against.
import { pathToFileURL } from "url";
import type { TransferListItem, WorkerOptions } from "worker_threads";
import { Worker as NodeWorker, parentPort } from "worker_threads";

import { globalServiceRegistry } from "../di";
import type { WorkerServerBaseOptions } from "./WorkerServerBase";
import { WORKER_SERVER, WorkerServerBase } from "./WorkerServerBase";

export { WORKER_SERVER };

/** Web `Worker` event names this polyfill forwards. */
type WorkerEventType = "message" | "messageerror" | "error";

type WorkerEventListener = (event: any) => void;

/**
 * Presents a `node:worker_threads` Worker through the web `Worker` interface
 * {@link WorkerManager} is written against.
 *
 * Two mismatches to bridge, both of which are silent rather than loud:
 *
 * - `worker_threads` accepts a `URL` **object** or a path, but rejects a
 *   stringified `file://` URL with `ERR_WORKER_PATH`. Every call site builds
 *   its script reference as `new URL("./worker.js", import.meta.url)`, so a
 *   URL has to be passed through untouched; only a plain path is converted.
 * - Node's `Worker` is an `EventEmitter`, not an `EventTarget`, so `on("message")`
 *   hands the listener the deserialized value directly. `WorkerManager` reads
 *   `event.data`, which would be `undefined` — the ready handshake never
 *   resolves and every worker times out. Listeners are therefore wrapped to
 *   arrive in the `MessageEvent` / `ErrorEvent` shape the web API delivers.
 */
class WorkerPolyfill extends NodeWorker {
  /**
   * The emitter-shaped listener actually registered for each
   * (listener, event type) pair, so `removeEventListener` can take the same
   * function back off. Weak on the caller's listener: `WorkerManager` creates
   * a fresh closure per call, and a long-lived worker would otherwise
   * accumulate one entry per request forever.
   */
  readonly #adapters = new WeakMap<WorkerEventListener, Map<string, WorkerEventListener>>();

  constructor(scriptUrl: string | URL, options?: WorkerOptions) {
    super(typeof scriptUrl === "string" ? pathToFileURL(scriptUrl) : scriptUrl, options);
  }

  #adapt(type: WorkerEventType, listener: WorkerEventListener): WorkerEventListener {
    let perType = this.#adapters.get(listener);
    if (perType === undefined) {
      perType = new Map();
      this.#adapters.set(listener, perType);
    }
    let wrapped = perType.get(type);
    if (wrapped === undefined) {
      wrapped =
        type === "error"
          ? // `filename` / `lineno` have no `worker_threads` equivalent; they
            // stay undefined rather than being faked from the stack.
            (error: Error) => listener({ type, message: error?.message, error })
          : (data: unknown) => listener({ type, data });
      perType.set(type, wrapped);
    }
    return wrapped;
  }

  addEventListener(type: WorkerEventType, listener: WorkerEventListener): void {
    this.on(type, this.#adapt(type, listener));
  }

  removeEventListener(type: WorkerEventType, listener: WorkerEventListener): void {
    const wrapped = this.#adapters.get(listener)?.get(type);
    if (wrapped === undefined) return;
    this.off(type, wrapped);
    this.#adapters.get(listener)?.delete(type);
  }
}

/**
 * {@link WorkerPolyfill} presented as the web `Worker` constructor.
 *
 * `WorkerManager`, and every `worker:` option on an AI provider, is typed
 * against the DOM `Worker` — which is exactly what the browser build exports —
 * so this build has to present the same type or no call site could name both.
 * The assertion is what the polyfill exists to make true: it supplies the
 * constructor, `postMessage`, `terminate`, and the `addEventListener` /
 * `removeEventListener` pair those callers use. Web-only members it does not
 * implement (`onmessage`, `dispatchEvent`) are unused across the repo.
 *
 * `{ type: "module" }` at the call sites rides along the same way:
 * `worker_threads` has no such option and ignores it, deciding ESM from the
 * worker file's extension and its package `type` instead.
 */
const Worker = WorkerPolyfill as unknown as typeof globalThis.Worker;
export { parentPort, Worker };

export class WorkerServer extends WorkerServerBase {
  constructor(options?: WorkerServerBaseOptions) {
    const port = parentPort;
    if (port === null) {
      throw new Error(
        "WorkerServer requires a worker thread: `parentPort` is null, so this is the main thread."
      );
    }
    // Node worker threads expose no global `postMessage` — the port is the only
    // way back to the parent — so the base class is given a bound sender rather
    // than left to find one on `globalThis`.
    super({
      ...options,
      post: (message, transfer) =>
        port.postMessage(message, transfer as readonly TransferListItem[]),
    });
    port.addEventListener("message", async (event) => {
      const msg = {
        type: event.type,
        data: (event as unknown as { readonly data: unknown }).data,
      };
      await this.handleMessage(msg);
    });
  }
}

globalServiceRegistry.register(WORKER_SERVER, () => new WorkerServer(), true);
