/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskAbortedError } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";
import {
  createStreamEventQueue,
  createStreamingTextStreamer,
  createTextStreamer,
} from "@workglow/ai-provider/src/provider-hf-transformers/common/HFT_Streaming";

/**
 * Minimal mock for the TextStreamer class. Captures the callback_function
 * passed in at construction time so tests can invoke it directly.
 */
class MockTextStreamer {
  callback_function: (text: string) => void;

  constructor(_tokenizer: any, options: { callback_function: (text: string) => void }) {
    this.callback_function = options.callback_function;
  }

  /** Simulate the model emitting a token. */
  emit(text: string) {
    this.callback_function(text);
  }
}

const mockTokenizer = {};

// ─── createStreamEventQueue ───────────────────────────────────────────────────

describe("createStreamEventQueue", () => {
  it("delivers pushed events via the async iterable", async () => {
    const queue = createStreamEventQueue<{ value: string }>();
    queue.push({ value: "a" });
    queue.push({ value: "b" });
    queue.done();

    const collected: { value: string }[] = [];
    for await (const item of queue.iterable) {
      collected.push(item);
    }
    expect(collected).toEqual([{ value: "a" }, { value: "b" }]);
  });

  it("propagates errors through the async iterable", async () => {
    const queue = createStreamEventQueue<{ value: string }>();
    const err = new Error("stream error");
    queue.error(err);

    await expect(
      (async () => {
        for await (const _ of queue.iterable) {
          // should not reach here
        }
      })()
    ).rejects.toThrow("stream error");
  });
});

// ─── createStreamingTextStreamer ──────────────────────────────────────────────

describe("createStreamingTextStreamer", () => {
  it("pushes text-delta events to the queue when not aborted", () => {
    const queue = createStreamEventQueue<any>();
    const pushed: any[] = [];
    const origPush = queue.push.bind(queue);
    queue.push = (e) => {
      pushed.push(e);
      origPush(e);
    };

    const streamer = createStreamingTextStreamer(mockTokenizer, queue, MockTextStreamer as any);
    (streamer as unknown as MockTextStreamer).emit("Hello");
    (streamer as unknown as MockTextStreamer).emit(" world");

    expect(pushed).toEqual([
      { type: "text-delta", port: "text", textDelta: "Hello" },
      { type: "text-delta", port: "text", textDelta: " world" },
    ]);
  });

  it("throws TaskAbortedError when the signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();

    const queue = createStreamEventQueue<any>();
    const streamer = createStreamingTextStreamer(
      mockTokenizer,
      queue,
      MockTextStreamer as any,
      controller.signal
    );

    expect(() => (streamer as unknown as MockTextStreamer).emit("Hello")).toThrow(TaskAbortedError);
  });

  it("propagates signal.reason when the caller aborts with a custom error", () => {
    const customError = new Error("custom reason");
    const controller = new AbortController();
    controller.abort(customError);

    const queue = createStreamEventQueue<any>();
    const streamer = createStreamingTextStreamer(
      mockTokenizer,
      queue,
      MockTextStreamer as any,
      controller.signal
    );

    expect(() => (streamer as unknown as MockTextStreamer).emit("Hello")).toThrow(customError);
  });

  it("does not throw when signal is present but not yet aborted", () => {
    const controller = new AbortController();

    const queue = createStreamEventQueue<any>();
    const streamer = createStreamingTextStreamer(
      mockTokenizer,
      queue,
      MockTextStreamer as any,
      controller.signal
    );

    expect(() => (streamer as unknown as MockTextStreamer).emit("Hello")).not.toThrow();
  });

  it("stops emitting events after abort mid-stream", () => {
    const controller = new AbortController();
    const queue = createStreamEventQueue<any>();
    const pushed: any[] = [];
    const origPush = queue.push.bind(queue);
    queue.push = (e) => {
      pushed.push(e);
      origPush(e);
    };

    const streamer = createStreamingTextStreamer(
      mockTokenizer,
      queue,
      MockTextStreamer as any,
      controller.signal
    );

    (streamer as unknown as MockTextStreamer).emit("token1");
    controller.abort(); // abort after first token
    expect(() => (streamer as unknown as MockTextStreamer).emit("token2")).toThrow(
      TaskAbortedError
    );

    // Only the first token should have been pushed
    expect(pushed).toHaveLength(1);
    expect(pushed[0].textDelta).toBe("token1");
  });
});

// ─── createTextStreamer ───────────────────────────────────────────────────────

describe("createTextStreamer", () => {
  it("calls updateProgress for each token when not aborted", () => {
    const calls: { progress: number; message?: string; details?: any }[] = [];
    const updateProgress = (progress: number, message?: string, details?: any) => {
      calls.push({ progress, message, details });
    };

    const streamer = createTextStreamer(mockTokenizer, updateProgress, MockTextStreamer as any);
    (streamer as unknown as MockTextStreamer).emit("Hello");
    (streamer as unknown as MockTextStreamer).emit(" world");

    expect(calls).toHaveLength(2);
    expect(calls[0].message).toBe("Generating");
    expect(calls[0].details.text).toBe("Hello");
    expect(calls[1].details.text).toBe(" world");
    // Progress should increase monotonically
    expect(calls[1].progress).toBeGreaterThanOrEqual(calls[0].progress);
  });

  it("throws TaskAbortedError when the signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();

    const streamer = createTextStreamer(
      mockTokenizer,
      () => {},
      MockTextStreamer as any,
      controller.signal
    );

    expect(() => (streamer as unknown as MockTextStreamer).emit("Hello")).toThrow(TaskAbortedError);
  });

  it("propagates signal.reason when the caller aborts with a custom error", () => {
    const customError = new Error("custom reason");
    const controller = new AbortController();
    controller.abort(customError);

    const streamer = createTextStreamer(
      mockTokenizer,
      () => {},
      MockTextStreamer as any,
      controller.signal
    );

    expect(() => (streamer as unknown as MockTextStreamer).emit("Hello")).toThrow(customError);
  });

  it("does not throw when signal is present but not yet aborted", () => {
    const controller = new AbortController();

    const streamer = createTextStreamer(
      mockTokenizer,
      () => {},
      MockTextStreamer as any,
      controller.signal
    );

    expect(() => (streamer as unknown as MockTextStreamer).emit("Hello")).not.toThrow();
  });

  it("stops calling updateProgress after abort mid-stream", () => {
    const controller = new AbortController();
    const calls: number[] = [];
    const updateProgress = (progress: number) => calls.push(progress);

    const streamer = createTextStreamer(
      mockTokenizer,
      updateProgress,
      MockTextStreamer as any,
      controller.signal
    );

    (streamer as unknown as MockTextStreamer).emit("token1");
    controller.abort();
    expect(() => (streamer as unknown as MockTextStreamer).emit("token2")).toThrow(TaskAbortedError);

    // Only one progress call should have happened
    expect(calls).toHaveLength(1);
  });
});
