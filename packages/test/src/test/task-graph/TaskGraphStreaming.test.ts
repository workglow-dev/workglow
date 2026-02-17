/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Dataflow,
  getOutputStreamMode,
  IExecuteContext,
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskStatus,
  type StreamEvent,
} from "@workglow/task-graph";
import { DataPortSchema, sleep } from "@workglow/util";
import { describe, expect, it } from "vitest";

// ============================================================================
// Test Tasks for DAG streaming
// ============================================================================

type TextInput = { prompt: string };
type TextOutput = { text: string };

/**
 * A streaming source task (append mode) that yields 5 text-delta chunks.
 */
class StreamSourceTask extends Task<TextInput, TextOutput> {
  public static type = "StreamSourceTask";
  public static cacheable = false;

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        prompt: { type: "string", default: "test" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "append" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: TextInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<TextOutput>> {
    const words = ["one", " ", "two", " ", "three"];
    for (const word of words) {
      if (context.signal.aborted) return;
      yield { type: "text-delta", port: "text", textDelta: word };
      await sleep(10);
    }
    yield { type: "finish", data: { text: "one two three" } };
  }

  async execute(input: TextInput, context: IExecuteContext): Promise<TextOutput | undefined> {
    return { text: "one two three" };
  }
}

/**
 * A streaming consumer task that consumes input and transforms.
 * Declared as streamable so the scheduler lets it start when deps are STREAMING.
 */
class StreamConsumerTask extends Task<TextInput, TextOutput> {
  public static type = "StreamConsumerTask";
  public static cacheable = false;

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", default: "", "x-stream": "append" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "append" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: any, context: IExecuteContext): Promise<TextOutput | undefined> {
    return { text: `processed: ${input.text || ""}` };
  }

  async *executeStream(
    input: any,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<TextOutput>> {
    yield {
      type: "text-delta",
      port: "text",
      textDelta: `processed: ${input.text || ""}`,
    };
    yield { type: "finish", data: { text: `processed: ${input.text || ""}` } };
  }
}

/**
 * A non-streaming consumer task that needs full input.
 */
class NonStreamConsumerTask extends Task<TextInput, TextOutput> {
  public static type = "NonStreamConsumerTask";
  public static cacheable = false;

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", default: "" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: any, context: IExecuteContext): Promise<TextOutput | undefined> {
    return { text: `final: ${input.text || ""}` };
  }
}

/**
 * An append-mode streaming source that yields EMPTY finish data, matching
 * real provider behavior (e.g. OpenAI, Anthropic).  Without edge-level
 * accumulation the non-streaming downstream would receive undefined.
 */
class AppendEmptyFinishSource extends Task<TextInput, TextOutput> {
  public static type = "AppendEmptyFinishSource";
  public static cacheable = false;

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        prompt: { type: "string", default: "test" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "append" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: TextInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<TextOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "edge " };
    yield { type: "text-delta", port: "text", textDelta: "accumulated" };
    // Empty finish – exactly what real providers emit in append mode
    yield { type: "finish", data: {} as TextOutput };
  }

  async execute(input: TextInput, context: IExecuteContext): Promise<TextOutput | undefined> {
    return { text: "edge accumulated" };
  }
}

/**
 * A replace-mode streaming source task.
 */
class ReplaceSourceTask extends Task<TextInput, TextOutput> {
  public static type = "ReplaceSourceTask";
  public static cacheable = false;

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        prompt: { type: "string", default: "test" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string", "x-stream": "replace" },
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: TextInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<TextOutput>> {
    yield { type: "snapshot", data: { text: "Hello" } };
    yield { type: "snapshot", data: { text: "Hello world" } };
    yield { type: "snapshot", data: { text: "Hello world!" } };
    yield { type: "finish", data: { text: "Hello world!" } };
  }

  async execute(input: TextInput, context: IExecuteContext): Promise<TextOutput | undefined> {
    return { text: "Hello world!" };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("TaskGraph Streaming", () => {
  let graph: TaskGraph;
  let runner: TaskGraphRunner;

  describe("Scheduler streaming readiness", () => {
    it("should mark streamable tasks as ready when dependencies are STREAMING", async () => {
      graph = new TaskGraph();

      const source = new StreamSourceTask({ prompt: "test" }, { id: "source" });
      const consumer = new StreamConsumerTask({} as any, { id: "consumer" });

      graph.addTasks([source, consumer]);
      graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));

      runner = new TaskGraphRunner(graph);

      // Track status transitions for both tasks
      const sourceStatuses: TaskStatus[] = [];
      const consumerStatuses: TaskStatus[] = [];

      source.on("status", (s) => sourceStatuses.push(s));
      consumer.on("status", (s) => consumerStatuses.push(s));

      await runner.runGraph({ prompt: "test" });

      // Source should have gone through STREAMING
      expect(sourceStatuses).toContain(TaskStatus.STREAMING);
      expect(sourceStatuses).toContain(TaskStatus.COMPLETED);

      // Consumer should have completed
      expect(consumerStatuses).toContain(TaskStatus.COMPLETED);
    });

    it("should NOT start non-streaming tasks when deps are only STREAMING", async () => {
      graph = new TaskGraph();

      const source = new StreamSourceTask({ prompt: "test" }, { id: "source" });
      const nonStreamConsumer = new NonStreamConsumerTask({} as any, { id: "non-stream" });

      graph.addTasks([source, nonStreamConsumer]);
      graph.addDataflow(new Dataflow("source", "text", "non-stream", "text"));

      runner = new TaskGraphRunner(graph);

      const nonStreamStartTimes: number[] = [];
      const sourceCompleteTimes: number[] = [];

      nonStreamConsumer.on("status", (s) => {
        if (s === TaskStatus.PROCESSING) {
          nonStreamStartTimes.push(Date.now());
        }
      });

      source.on("status", (s) => {
        if (s === TaskStatus.COMPLETED) {
          sourceCompleteTimes.push(Date.now());
        }
      });

      await runner.runGraph({ prompt: "test" });

      // Non-streaming consumer should have started AFTER source completed
      expect(sourceCompleteTimes.length).toBe(1);
      expect(nonStreamStartTimes.length).toBe(1);
      expect(nonStreamStartTimes[0]).toBeGreaterThanOrEqual(sourceCompleteTimes[0]);

      // Non-streaming consumer should have received the final output
      expect(nonStreamConsumer.status).toBe(TaskStatus.COMPLETED);
    });
  });

  describe("Streaming chain", () => {
    it("should execute StreamSourceTask -> StreamConsumerTask pipeline", async () => {
      graph = new TaskGraph();

      const source = new StreamSourceTask({ prompt: "test" }, { id: "source" });
      const consumer = new StreamConsumerTask({} as any, { id: "consumer" });

      graph.addTasks([source, consumer]);
      graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));

      runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph({ prompt: "test" });

      // Both tasks should complete
      expect(source.status).toBe(TaskStatus.COMPLETED);
      expect(consumer.status).toBe(TaskStatus.COMPLETED);

      // Consumer is a leaf, so we get its results
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("consumer");
    });
  });

  describe("Mixed chain (streaming + non-streaming downstream)", () => {
    it("should handle fan-out to both streaming and non-streaming consumers", async () => {
      graph = new TaskGraph();

      const source = new StreamSourceTask({ prompt: "test" }, { id: "source" });
      const streamConsumer = new StreamConsumerTask({} as any, { id: "stream-consumer" });
      const nonStreamConsumer = new NonStreamConsumerTask({} as any, { id: "non-stream-consumer" });

      graph.addTasks([source, streamConsumer, nonStreamConsumer]);
      graph.addDataflow(new Dataflow("source", "text", "stream-consumer", "text"));
      graph.addDataflow(new Dataflow("source", "text", "non-stream-consumer", "text"));

      runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph({ prompt: "test" });

      // All tasks should complete
      expect(source.status).toBe(TaskStatus.COMPLETED);
      expect(streamConsumer.status).toBe(TaskStatus.COMPLETED);
      expect(nonStreamConsumer.status).toBe(TaskStatus.COMPLETED);

      // Both consumers are leaves
      expect(results.length).toBe(2);
    });
  });

  describe("Replace chain", () => {
    it("should handle replace source -> non-streaming consumer", async () => {
      graph = new TaskGraph();

      const source = new ReplaceSourceTask({ prompt: "test" }, { id: "source" });
      const consumer = new NonStreamConsumerTask({} as any, { id: "consumer" });

      graph.addTasks([source, consumer]);
      graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));

      runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph({ prompt: "test" });

      // Non-streaming task waits for full completion and gets final snapshot
      expect(source.status).toBe(TaskStatus.COMPLETED);
      expect(consumer.status).toBe(TaskStatus.COMPLETED);

      // Source should have the final snapshot in runOutputData
      expect(source.runOutputData.text).toBe("Hello world!");

      // Consumer should have received the final result
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("consumer");
      expect((results[0].data as any).text).toBe("final: Hello world!");
    });
  });

  describe("Stream events on dataflow edges", () => {
    it("should set stream on outgoing dataflow edges for streaming tasks", async () => {
      graph = new TaskGraph();

      const source = new StreamSourceTask({ prompt: "test" }, { id: "source" });
      const consumer = new StreamConsumerTask({} as any, { id: "consumer" });

      graph.addTasks([source, consumer]);
      const dataflow = new Dataflow("source", "text", "consumer", "text");
      graph.addDataflow(dataflow);

      runner = new TaskGraphRunner(graph);

      // Listen for streaming status on the dataflow
      let streamingStatusSeen = false;
      dataflow.on("streaming", () => {
        streamingStatusSeen = true;
      });

      await runner.runGraph({ prompt: "test" });

      // The dataflow should have seen streaming status
      expect(streamingStatusSeen).toBe(true);
    });
  });

  describe("Dataflow stream and reset", () => {
    it("should clear stream on dataflow reset", () => {
      const dataflow = new Dataflow("a", "out", "b", "in");
      const mockStream = new ReadableStream();
      dataflow.setStream(mockStream);
      expect(dataflow.getStream()).toBe(mockStream);

      dataflow.reset();
      expect(dataflow.getStream()).toBeUndefined();
      expect(dataflow.value).toBeUndefined();
      expect(dataflow.status).toBe(TaskStatus.PENDING);
    });

    it("should handle STREAMING status on dataflow", () => {
      const dataflow = new Dataflow("a", "out", "b", "in");
      const statuses: TaskStatus[] = [];
      dataflow.on("status", (s) => statuses.push(s));

      dataflow.setStatus(TaskStatus.STREAMING);

      expect(dataflow.status).toBe(TaskStatus.STREAMING);
      expect(statuses).toContain(TaskStatus.STREAMING);
    });
  });

  describe("Edge-level stream accumulation", () => {
    it("should accumulate text-deltas for non-streaming downstream (append, empty finish)", async () => {
      graph = new TaskGraph();

      const source = new AppendEmptyFinishSource({ prompt: "test" }, { id: "source" });
      const consumer = new NonStreamConsumerTask({} as any, { id: "consumer" });

      graph.addTasks([source, consumer]);
      graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));

      runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph({ prompt: "test" });

      expect(source.status).toBe(TaskStatus.COMPLETED);
      expect(consumer.status).toBe(TaskStatus.COMPLETED);

      // The non-streaming consumer should have received the ACCUMULATED text
      // from the stream, not the empty finish data.
      expect(results.length).toBe(1);
      expect((results[0].data as any).text).toBe("final: edge accumulated");
    });

    it("should accumulate for fan-out where one downstream is non-streaming", async () => {
      graph = new TaskGraph();

      const source = new AppendEmptyFinishSource({ prompt: "test" }, { id: "source" });
      const streamConsumer = new StreamConsumerTask({} as any, { id: "stream-c" });
      const nonStreamConsumer = new NonStreamConsumerTask({} as any, { id: "non-stream-c" });

      graph.addTasks([source, streamConsumer, nonStreamConsumer]);
      graph.addDataflow(new Dataflow("source", "text", "stream-c", "text"));
      graph.addDataflow(new Dataflow("source", "text", "non-stream-c", "text"));

      runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph({ prompt: "test" });

      expect(source.status).toBe(TaskStatus.COMPLETED);
      expect(streamConsumer.status).toBe(TaskStatus.COMPLETED);
      expect(nonStreamConsumer.status).toBe(TaskStatus.COMPLETED);

      // The non-streaming consumer should have the accumulated value
      const nonStreamResult = results.find((r) => r.id === "non-stream-c");
      expect(nonStreamResult).toBeDefined();
      expect((nonStreamResult!.data as any).text).toBe("final: edge accumulated");
    });

    it("should accumulate replace-mode snapshots for non-streaming downstream", async () => {
      graph = new TaskGraph();

      const source = new ReplaceSourceTask({ prompt: "test" }, { id: "source" });
      const consumer = new NonStreamConsumerTask({} as any, { id: "consumer" });

      graph.addTasks([source, consumer]);
      graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));

      runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph({ prompt: "test" });

      // Replace mode: the last snapshot should be materialized
      expect((results[0].data as any).text).toBe("final: Hello world!");
    });
  });

  describe("Dataflow.awaitStreamValue", () => {
    it("should accumulate text-delta events into value", async () => {
      const dataflow = new Dataflow("a", "text", "b", "text");

      const stream = new ReadableStream<StreamEvent>({
        start(controller) {
          controller.enqueue({ type: "text-delta", port: "text", textDelta: "hello" });
          controller.enqueue({ type: "text-delta", port: "text", textDelta: " world" });
          controller.enqueue({ type: "finish", data: {} });
          controller.close();
        },
      });

      dataflow.setStream(stream);
      await dataflow.awaitStreamValue();

      // For specific-port dataflow, value is the accumulated string
      expect(dataflow.value).toBe("hello world");
      expect(dataflow.getStream()).toBeUndefined();
    });

    it("should use last snapshot for replace-mode events", async () => {
      const dataflow = new Dataflow("a", "text", "b", "text");

      const stream = new ReadableStream<StreamEvent>({
        start(controller) {
          controller.enqueue({ type: "snapshot", data: { text: "partial" } });
          controller.enqueue({ type: "snapshot", data: { text: "complete" } });
          controller.enqueue({ type: "finish", data: { text: "complete" } });
          controller.close();
        },
      });

      dataflow.setStream(stream);
      await dataflow.awaitStreamValue();

      // Last snapshot is used via setPortData, which extracts the port value
      expect(dataflow.value).toBe("complete");
    });

    it("should prefer non-empty finish data over text-delta accumulation", async () => {
      const dataflow = new Dataflow("a", "text", "b", "text");

      const stream = new ReadableStream<StreamEvent>({
        start(controller) {
          controller.enqueue({ type: "text-delta", port: "text", textDelta: "partial" });
          controller.enqueue({ type: "finish", data: { text: "full result" } });
          controller.close();
        },
      });

      dataflow.setStream(stream);
      await dataflow.awaitStreamValue();

      // Finish data takes priority over text-delta accumulation
      expect(dataflow.value).toBe("full result");
    });

    it("should handle DATAFLOW_ALL_PORTS for append mode using output schema", async () => {
      const dataflow = new Dataflow("a", "*", "b", "*");

      const stream = new ReadableStream<StreamEvent>({
        start(controller) {
          controller.enqueue({ type: "text-delta", port: "text", textDelta: "abc" });
          controller.enqueue({ type: "text-delta", port: "text", textDelta: "def" });
          controller.enqueue({ type: "finish", data: {} });
          controller.close();
        },
      });

      dataflow.setStream(stream);
      await dataflow.awaitStreamValue();

      expect(dataflow.value).toEqual({ text: "abcdef" });
    });

    it("should handle DATAFLOW_ALL_PORTS with non-text append port from schema", async () => {
      const dataflow = new Dataflow("a", "*", "b", "*");

      const stream = new ReadableStream<StreamEvent>({
        start(controller) {
          controller.enqueue({ type: "text-delta", port: "code", textDelta: "fn main() {" });
          controller.enqueue({ type: "text-delta", port: "code", textDelta: "}" });
          controller.enqueue({ type: "finish", data: {} });
          controller.close();
        },
      });

      dataflow.setStream(stream);
      await dataflow.awaitStreamValue();

      expect(dataflow.value).toEqual({ code: "fn main() {}" });
    });

    it("should handle DATAFLOW_ALL_PORTS with text-deltas using port from events (no schema needed)", async () => {
      const dataflow = new Dataflow("a", "*", "b", "*");

      const stream = new ReadableStream<StreamEvent>({
        start(controller) {
          controller.enqueue({ type: "text-delta", port: "text", textDelta: "abc" });
          controller.enqueue({ type: "finish", data: {} });
          controller.close();
        },
      });

      dataflow.setStream(stream);
      await dataflow.awaitStreamValue();

      // Port comes from events; no output schema needed
      expect(dataflow.value).toEqual({ text: "abc" });
    });

    it("should throw and set FAILED status on stream error events", async () => {
      const dataflow = new Dataflow("a", "text", "b", "text");

      const stream = new ReadableStream<StreamEvent>({
        start(controller) {
          controller.enqueue({ type: "text-delta", port: "text", textDelta: "partial" });
          controller.enqueue({ type: "error", error: new Error("upstream failure") });
          controller.close();
        },
      });

      dataflow.setStream(stream);
      await expect(dataflow.awaitStreamValue()).rejects.toThrow("upstream failure");
      expect(dataflow.status).toBe(TaskStatus.FAILED);
      expect(dataflow.error).toBeInstanceOf(Error);
    });

    it("should be a no-op when no stream is present", async () => {
      const dataflow = new Dataflow("a", "text", "b", "text");
      dataflow.value = "existing";

      await dataflow.awaitStreamValue();

      expect(dataflow.value).toBe("existing");
    });
  });

  describe("Abort during streaming graph", () => {
    it("should abort streaming tasks when graph is aborted", async () => {
      graph = new TaskGraph();

      // Use a slow streaming source
      const source = new StreamSourceTask({ prompt: "test" }, { id: "source" });
      const consumer = new NonStreamConsumerTask({} as any, { id: "consumer" });

      graph.addTasks([source, consumer]);
      graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));

      runner = new TaskGraphRunner(graph);

      const runPromise = runner.runGraph({ prompt: "test" });

      // Give it a moment to start, then abort
      await sleep(20);
      runner.abort();

      try {
        await runPromise;
      } catch (err: any) {
        // Expected abort error
        expect(err.message).toContain("abort");
      }
    });
  });

  describe("Port-level streaming in graph", () => {
    it("should use x-stream annotation to determine streaming in graph execution", async () => {
      graph = new TaskGraph();

      const source = new StreamSourceTask({ prompt: "test" }, { id: "source" });
      const consumer = new NonStreamConsumerTask({} as any, { id: "consumer" });

      graph.addTasks([source, consumer]);
      graph.addDataflow(new Dataflow("source", "text", "consumer", "text"));

      runner = new TaskGraphRunner(graph);
      const results = await runner.runGraph({ prompt: "test" });

      expect(results.length).toBeGreaterThan(0);
      const consumerResult = results.find((r) => r.id === "consumer");
      expect(consumerResult).toBeDefined();
      expect((consumerResult!.data as any).text).toContain("final:");
    });

    it("should detect output stream mode from schema", () => {
      expect(getOutputStreamMode(StreamSourceTask.outputSchema())).toBe("append");
      expect(getOutputStreamMode(ReplaceSourceTask.outputSchema())).toBe("replace");
      expect(getOutputStreamMode(NonStreamConsumerTask.outputSchema())).toBe("none");
    });
  });
});
