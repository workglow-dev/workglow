/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pins where a worker server's replies go out.
 *
 * `WorkerServerBase` used to call the bare global `postMessage`, which a
 * browser (and Bun) worker scope provides and a Node worker thread does not —
 * so every reply from a Node worker died with `ReferenceError: postMessage is
 * not defined`. The `lib: ["dom"]` in the root tsconfig meant it typechecked,
 * and the sibling suites here stub the global, so nothing caught it.
 *
 * The sender is now a seam: the browser server keeps the global, and
 * `Worker.node.ts` binds `parentPort.postMessage`.
 */

import { WorkerServer, WorkerServerBase } from "@workglow/util/worker";
import { afterEach, describe, expect, it } from "vitest";

interface PostedMessage {
  readonly type: string;
  readonly id?: string;
  readonly data?: unknown;
}

const restores: Array<() => void> = [];

/** Removes the global `postMessage`, as a Node worker thread has none. */
function withoutGlobalPostMessage(): void {
  const original = (globalThis as { postMessage?: unknown }).postMessage;
  delete (globalThis as { postMessage?: unknown }).postMessage;
  restores.push(() => {
    if (typeof original === "function") {
      (globalThis as { postMessage?: unknown }).postMessage = original;
    }
  });
}

/** Installs a capturing global `postMessage`, as a browser worker scope has. */
function withGlobalPostMessage(captured: PostedMessage[]): void {
  const original = (globalThis as { postMessage?: unknown }).postMessage;
  (globalThis as unknown as { postMessage: (m: PostedMessage) => void }).postMessage = (m) => {
    captured.push(m);
  };
  restores.push(() => {
    if (typeof original === "function") {
      (globalThis as { postMessage?: unknown }).postMessage = original;
    } else {
      delete (globalThis as { postMessage?: unknown }).postMessage;
    }
  });
}

afterEach(() => {
  while (restores.length > 0) restores.pop()!();
});

describe("WorkerServerBase message sender", () => {
  it("sends through an injected post, ignoring any global", () => {
    const viaGlobal: PostedMessage[] = [];
    withGlobalPostMessage(viaGlobal);
    const viaPort: PostedMessage[] = [];

    const server = new WorkerServerBase({
      post: (message) => viaPort.push(message as PostedMessage),
    });
    server.registerFunction("noop", async () => undefined);
    server.sendReady();

    expect(viaPort.map((m) => m.type)).toEqual(["ready"]);
    expect(viaGlobal).toEqual([]);
  });

  it("passes the transfer list through to the injected post", async () => {
    const transfers: Array<readonly unknown[] | undefined> = [];
    const server = new WorkerServerBase({
      post: (_message, transfer) => transfers.push(transfer),
    });
    const values = new Float32Array([1, 2, 3]);
    server.registerFunction("vector", async () => ({ values }));

    await server.handleMessage({
      type: "message",
      data: { type: "call", id: "req-1", functionName: "vector", args: [{}, undefined] },
    });

    expect(transfers).toEqual([[values.buffer]]);
  });

  it("falls back to the global postMessage, resolved per call", () => {
    const captured: PostedMessage[] = [];
    // Built BEFORE the global exists: the default must look the global up when
    // it sends, not capture it at construction, or every suite that stubs
    // `globalThis.postMessage` after building a server would capture nothing.
    const server = new WorkerServerBase();
    withGlobalPostMessage(captured);
    server.sendReady();

    expect(captured.map((m) => m.type)).toEqual(["ready"]);
  });

  it("names the missing seam when there is no sender at all", () => {
    withoutGlobalPostMessage();
    const server = new WorkerServerBase();

    // Previously a bare `ReferenceError: postMessage is not defined`, which
    // said nothing about which platform binding had gone unwired.
    expect(() => server.sendReady()).toThrow(/no global postMessage/);
  });
});

describe("WorkerServer for worker_threads", () => {
  it("refuses to construct off a worker thread", () => {
    // The node server binds `parentPort`, which is null on the main thread.
    // Constructing anyway is what silently produced a server that could
    // receive but never reply.
    expect(() => new WorkerServer()).toThrow(/requires a worker thread/);
  });
});
