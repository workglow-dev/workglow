/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  IExecuteContext,
  Task,
  TaskStatus,
  getOutputStreamMode,
  isTaskStreamable,
  type StreamEvent,
} from "@workglow/task-graph";
import { DataPortSchema, sleep } from "@workglow/util";
import { describe, expect, it } from "vitest";
import { InMemoryTaskOutputRepository } from "../../binding/InMemoryTaskOutputRepository";

// ============================================================================
// Test Tasks
// ============================================================================

type StreamTestInput = { prompt: string };
type StreamTestOutput = { text: string };

/**
 * A test task that streams in append mode (text-delta chunks).
 * Yields 3 text-delta events, then a finish with empty data.
 */
class TestStreamingAppendTask extends Task<StreamTestInput, StreamTestOutput> {
  public static type = "TestStreamingAppendTask";
  public static cacheable = true;

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        prompt: { type: "string" },
      },
      required: ["prompt"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "append" },
      },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: StreamTestInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<StreamTestOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "Hello" };
    yield { type: "text-delta", port: "text", textDelta: " " };
    yield { type: "text-delta", port: "text", textDelta: "world" };
    yield { type: "finish", data: {} as StreamTestOutput };
  }
}

/**
 * A test task that streams in replace mode (snapshot chunks).
 * Yields 3 snapshot events, then a finish with the final snapshot.
 */
class TestStreamingReplaceTask extends Task<StreamTestInput, StreamTestOutput> {
  public static type = "TestStreamingReplaceTask";
  public static cacheable = true;

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        prompt: { type: "string" },
      },
      required: ["prompt"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "replace" },
      },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: StreamTestInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<StreamTestOutput>> {
    yield { type: "snapshot", data: { text: "Bon" } };
    yield { type: "snapshot", data: { text: "Bonjour" } };
    yield { type: "snapshot", data: { text: "Bonjour le monde" } };
    yield { type: "finish", data: { text: "Bonjour le monde" } };
  }
}

/**
 * A test task that errors mid-stream after 2 chunks.
 */
class TestStreamingErrorTask extends Task<StreamTestInput, StreamTestOutput> {
  public static type = "TestStreamingErrorTask";
  public static cacheable = false;

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        prompt: { type: "string" },
      },
      required: ["prompt"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "append" },
      },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: StreamTestInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<StreamTestOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "Hello" };
    yield { type: "text-delta", port: "text", textDelta: " " };
    yield { type: "error", error: new Error("Stream error after 2 chunks") };
  }
}

/**
 * A test task that can be aborted mid-stream.
 */
class TestStreamingAbortableTask extends Task<StreamTestInput, StreamTestOutput> {
  public static type = "TestStreamingAbortableTask";
  public static cacheable = false;

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        prompt: { type: "string" },
      },
      required: ["prompt"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "append" },
      },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: StreamTestInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<StreamTestOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "Hello" };
    // Wait a bit so the test can abort mid-stream
    await sleep(100);
    if (context.signal.aborted) {
      return;
    }
    yield { type: "text-delta", port: "text", textDelta: " world" };
    yield { type: "finish", data: {} as StreamTestOutput };
  }
}

/**
 * A test task that streams in append mode using a non-text port name ("code").
 */
type CodeTestInput = { prompt: string };
type CodeTestOutput = { code: string };

class TestStreamingCodeAppendTask extends Task<CodeTestInput, CodeTestOutput> {
  public static type = "TestStreamingCodeAppendTask";
  public static cacheable = false;

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        prompt: { type: "string" },
      },
      required: ["prompt"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        code: { type: "string", "x-stream": "append" },
      },
      required: ["code"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: CodeTestInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<CodeTestOutput>> {
    yield { type: "text-delta", port: "code", textDelta: "fn main() {" };
    yield { type: "text-delta", port: "code", textDelta: ' println!("hi")' };
    yield { type: "text-delta", port: "code", textDelta: " }" };
    yield { type: "finish", data: {} as CodeTestOutput };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("TaskRunner Streaming", () => {
  describe("Append Mode", () => {
    it("should emit stream_start, stream_chunk, and stream_end events", async () => {
      const task = new TestStreamingAppendTask({ prompt: "test" });

      const events: string[] = [];
      const chunks: StreamEvent[] = [];

      task.on("stream_start", () => events.push("stream_start"));
      task.on("stream_chunk", (event) => {
        events.push("stream_chunk");
        chunks.push(event);
      });
      task.on("stream_end", () => events.push("stream_end"));

      await task.run({ prompt: "test" });

      expect(events).toContain("stream_start");
      expect(events).toContain("stream_end");
      expect(events.filter((e) => e === "stream_chunk").length).toBe(4); // 3 deltas + 1 finish
      expect(chunks[0]).toEqual({ type: "text-delta", port: "text", textDelta: "Hello" });
      expect(chunks[1]).toEqual({ type: "text-delta", port: "text", textDelta: " " });
      expect(chunks[2]).toEqual({ type: "text-delta", port: "text", textDelta: "world" });
      expect(chunks[3].type).toBe("finish");
    });

    it("should transition through PENDING -> PROCESSING -> STREAMING -> COMPLETED", async () => {
      const task = new TestStreamingAppendTask({ prompt: "test" });

      const statuses: TaskStatus[] = [];
      task.on("status", (status) => statuses.push(status));

      await task.run({ prompt: "test" });

      expect(statuses).toContain(TaskStatus.PROCESSING);
      expect(statuses).toContain(TaskStatus.STREAMING);
      expect(statuses).toContain(TaskStatus.COMPLETED);

      // STREAMING should come after PROCESSING
      const processingIdx = statuses.indexOf(TaskStatus.PROCESSING);
      const streamingIdx = statuses.indexOf(TaskStatus.STREAMING);
      const completedIdx = statuses.indexOf(TaskStatus.COMPLETED);
      expect(streamingIdx).toBeGreaterThan(processingIdx);
      expect(completedIdx).toBeGreaterThan(streamingIdx);
    });

    it("should accumulate text even when cache is off", async () => {
      const task = new TestStreamingAppendTask({ prompt: "test" }, { cacheable: false });

      const result = await task.run({ prompt: "test" });

      // In append mode, text-delta chunks are always accumulated regardless
      // of whether output cache is enabled
      expect(task.runOutputData.text).toBe("Hello world");
      expect(result.text).toBe("Hello world");
    });

    it("should accumulate text when output cache is enabled", async () => {
      const cache = new InMemoryTaskOutputRepository();
      await cache.setupDatabase();

      const task = new TestStreamingAppendTask({ prompt: "test" }, {}, { outputCache: cache });

      const result = await task.run({ prompt: "test" });

      // With cache enabled, the runner accumulates text-delta chunks
      expect(task.runOutputData.text).toBe("Hello world");
      expect(result.text).toBe("Hello world");

      // Verify it was actually cached
      const cached = await cache.getOutput("TestStreamingAppendTask", { prompt: "test" });
      expect(cached).toBeDefined();
      expect((cached as any)?.text).toBe("Hello world");
    });

    it("should serve from cache on second run (cache hit)", async () => {
      const cache = new InMemoryTaskOutputRepository();
      await cache.setupDatabase();

      const task1 = new TestStreamingAppendTask({ prompt: "test" }, {}, { outputCache: cache });
      await task1.run({ prompt: "test" });

      // Second run should hit cache
      const task2 = new TestStreamingAppendTask({ prompt: "test" }, {}, { outputCache: cache });

      const events: string[] = [];
      const chunks: StreamEvent[] = [];
      task2.on("stream_start", () => events.push("stream_start"));
      task2.on("stream_chunk", (event) => {
        events.push("stream_chunk");
        chunks.push(event);
      });
      task2.on("stream_end", () => events.push("stream_end"));

      const result = await task2.run({ prompt: "test" });

      // Cache hit: should emit stream_start, one finish chunk, stream_end
      expect(events).toContain("stream_start");
      expect(events).toContain("stream_end");
      expect(chunks.length).toBe(1);
      expect(chunks[0].type).toBe("finish");
      if (chunks[0].type === "finish") {
        expect(chunks[0].data.text).toBe("Hello world");
      }
      expect(result.text).toBe("Hello world");
    });

    it("should report progress during streaming", async () => {
      const task = new TestStreamingAppendTask({ prompt: "test" });

      const progressValues: number[] = [];
      task.on("progress", (progress) => progressValues.push(progress));

      await task.run({ prompt: "test" });

      expect(progressValues.length).toBeGreaterThan(0);
      // Progress should be increasing
      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
      }
      // Final progress should be 100 (set by handleComplete)
      expect(task.progress).toBe(100);
    });
  });

  describe("Replace Mode", () => {
    it("should emit snapshot chunks and update runOutputData on each", async () => {
      const task = new TestStreamingReplaceTask({ prompt: "test" });

      const snapshots: any[] = [];
      const runOutputSnapshots: any[] = [];

      task.on("stream_chunk", (event) => {
        if (event.type === "snapshot") {
          snapshots.push(event.data);
          // Capture runOutputData at time of chunk
          runOutputSnapshots.push({ ...task.runOutputData });
        }
      });

      await task.run({ prompt: "test" });

      expect(snapshots.length).toBe(3);
      expect(snapshots[0]).toEqual({ text: "Bon" });
      expect(snapshots[1]).toEqual({ text: "Bonjour" });
      expect(snapshots[2]).toEqual({ text: "Bonjour le monde" });

      // In replace mode, runOutputData is updated on each snapshot
      expect(runOutputSnapshots[0]).toEqual({ text: "Bon" });
      expect(runOutputSnapshots[1]).toEqual({ text: "Bonjour" });
      expect(runOutputSnapshots[2]).toEqual({ text: "Bonjour le monde" });
    });

    it("should have final snapshot in runOutputData after completion", async () => {
      const task = new TestStreamingReplaceTask({ prompt: "test" });

      const result = await task.run({ prompt: "test" });

      expect(task.runOutputData.text).toBe("Bonjour le monde");
      expect(result.text).toBe("Bonjour le monde");
    });

    it("should transition through STREAMING status", async () => {
      const task = new TestStreamingReplaceTask({ prompt: "test" });

      const statuses: TaskStatus[] = [];
      task.on("status", (status) => statuses.push(status));

      await task.run({ prompt: "test" });

      expect(statuses).toContain(TaskStatus.STREAMING);
      expect(statuses).toContain(TaskStatus.COMPLETED);
    });

    it("should cache the final snapshot with output cache enabled", async () => {
      const cache = new InMemoryTaskOutputRepository();
      await cache.setupDatabase();

      const task = new TestStreamingReplaceTask({ prompt: "test" }, {}, { outputCache: cache });

      await task.run({ prompt: "test" });

      const cached = await cache.getOutput("TestStreamingReplaceTask", { prompt: "test" });
      expect(cached).toBeDefined();
      expect((cached as any)?.text).toBe("Bonjour le monde");
    });
  });

  describe("Error Handling", () => {
    it("should throw and transition to FAILED on stream error", async () => {
      const task = new TestStreamingErrorTask({ prompt: "test" });

      const statuses: TaskStatus[] = [];
      task.on("status", (status) => statuses.push(status));

      await expect(task.run({ prompt: "test" })).rejects.toThrow("Stream error after 2 chunks");

      expect(task.status).toBe(TaskStatus.FAILED);
      expect(statuses).toContain(TaskStatus.FAILED);
    });

    it("should emit error event on stream error", async () => {
      const task = new TestStreamingErrorTask({ prompt: "test" });

      const errors: Error[] = [];
      task.on("error", (err) => errors.push(err));

      try {
        await task.run({ prompt: "test" });
      } catch {
        // Expected
      }

      expect(errors.length).toBe(1);
    });
  });

  describe("Abort Handling", () => {
    it("should abort a streaming task mid-stream", async () => {
      const task = new TestStreamingAbortableTask({ prompt: "test" });

      const chunks: StreamEvent[] = [];
      task.on("stream_chunk", (event) => chunks.push(event));

      // Start the task, then abort after a short delay
      const runPromise = task.run({ prompt: "test" });

      // Give the first chunk time to emit, then abort
      await sleep(30);
      task.abort();

      try {
        await runPromise;
      } catch {
        // Expected - abort causes error
      }

      // Should have received at least the first chunk
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(task.status).toBe(TaskStatus.ABORTING);
    });
  });

  describe("Non-text append port", () => {
    it("should accumulate text-deltas into the correct port name (code)", async () => {
      const task = new TestStreamingCodeAppendTask({ prompt: "test" });

      const result = await task.run({ prompt: "test" });

      expect((result as any).code).toBe('fn main() { println!("hi") }');
      expect(task.runOutputData).toHaveProperty("code");
      expect((task.runOutputData as any).code).toBe('fn main() { println!("hi") }');
    });

    it("should emit stream events for non-text port", async () => {
      const task = new TestStreamingCodeAppendTask({ prompt: "test" });

      const chunks: StreamEvent[] = [];
      task.on("stream_chunk", (event) => chunks.push(event));

      await task.run({ prompt: "test" });

      expect(chunks.filter((c) => c.type === "text-delta").length).toBe(3);
      expect(chunks.find((c) => c.type === "finish")).toBeDefined();
    });
  });

  describe("Port-level streaming detection", () => {
    it("should detect streaming via x-stream on output schema", async () => {
      const task = new TestStreamingAppendTask({ prompt: "test" });
      // isTaskStreamable checks output schema for x-stream and executeStream presence
      expect(isTaskStreamable(task)).toBe(true);
      expect(getOutputStreamMode(task.outputSchema())).toBe("append");
    });

    it("should detect replace mode via x-stream on output schema", () => {
      const task = new TestStreamingReplaceTask({ prompt: "test" });
      expect(getOutputStreamMode(task.outputSchema())).toBe("replace");
    });

    it("should use config streamMode when running append task with cache", async () => {
      const cache = new InMemoryTaskOutputRepository();
      await cache.setupDatabase();

      const task = new TestStreamingAppendTask({ prompt: "config-test" }, {}, { outputCache: cache });

      const result = await task.run({ prompt: "config-test" });

      expect(result.text).toBe("Hello world");
    });
  });
});
