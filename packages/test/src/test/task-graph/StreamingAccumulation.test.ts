/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for the source-task streaming accumulation system.
 *
 * Design principle: accumulation of streaming text-deltas happens once in the
 * source task (when shouldAccumulate=true), producing an enriched finish event
 * that carries the fully-assembled port data.  All downstream dataflow edges
 * share that enriched finish via tee'd ReadableStreams so no edge needs to
 * re-accumulate independently.
 *
 * Tests cover:
 *  - TaskRunner: enriched finish event is emitted when shouldAccumulate=true
 *  - TaskRunner: raw finish is emitted when shouldAccumulate=false
 *  - TaskGraphRunner.taskNeedsAccumulation: true when downstream is non-streaming
 *  - TaskGraphRunner.taskNeedsAccumulation: false when all downstream are streaming
 *  - Graph execution: append-mode task -> non-streaming consumer (materialises correctly)
 *  - Graph execution: replace-mode task with text-deltas -> non-streaming consumer
 *  - Graph execution: fan-out to multiple non-streaming consumers (single accumulation)
 *  - Cache: auto-enables accumulation
 */

import {
  Dataflow,
  IExecuteContext,
  IRunConfig,
  Task,
  TaskGraph,
  TaskGraphRunner,
  TaskStatus,
  type StreamEvent,
} from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTaskOutputRepository } from "../../binding/InMemoryTaskOutputRepository";

// ============================================================================
// Test task definitions
// ============================================================================

type SimpleInput = { prompt: string };
type SimpleOutput = { text: string };

/**
 * Append-mode task that emits text-delta chunks and an empty finish payload.
 * Mirrors real provider behavior (e.g. OpenAI, HFT TextRewriter).
 */
class AppendTask extends Task<SimpleInput, SimpleOutput> {
  public static type = "AccumTest_AppendTask";
  public static cacheable = false;

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { prompt: { type: "string", default: "test" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: SimpleInput,
    _context: IExecuteContext
  ): AsyncIterable<StreamEvent<SimpleOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "hello" };
    yield { type: "text-delta", port: "text", textDelta: " world" };
    // Empty finish -- source task must enrich this when shouldAccumulate=true
    yield { type: "finish", data: {} as SimpleOutput };
  }

  async execute(_input: SimpleInput): Promise<SimpleOutput | undefined> {
    return { text: "hello world" };
  }
}

/**
 * Replace-mode task that emits text-delta chunks (like HFT TextTranslation).
 * Real translators stream tokens even though the schema declares replace mode.
 */
class ReplaceWithTextDeltasTask extends Task<SimpleInput, SimpleOutput> {
  public static type = "AccumTest_ReplaceWithTextDeltasTask";
  public static cacheable = false;

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { prompt: { type: "string", default: "test" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "replace" } },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: SimpleInput,
    _context: IExecuteContext
  ): AsyncIterable<StreamEvent<SimpleOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "Bonjour" };
    yield { type: "text-delta", port: "text", textDelta: " monde" };
    // finish carries partial data (no "text" key) -- source task must merge accumulated
    yield { type: "finish", data: {} as SimpleOutput };
  }

  async execute(_input: SimpleInput): Promise<SimpleOutput | undefined> {
    return { text: "Bonjour monde" };
  }
}

/**
 * Streaming-input, streaming-output consumer that acts as a pass-through.
 * The source task should NOT accumulate when all edges go to streaming tasks.
 */
class StreamPassThroughTask extends Task<SimpleInput, SimpleOutput> {
  public static type = "AccumTest_StreamPassThroughTask";
  public static cacheable = false;

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", default: "", "x-stream": "append" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    input: any,
    _context: IExecuteContext
  ): AsyncIterable<StreamEvent<SimpleOutput>> {
    yield { type: "text-delta", port: "text", textDelta: `pass:${input.text ?? ""}` };
    yield { type: "finish", data: { text: `pass:${input.text ?? ""}` } };
  }

  async execute(input: any): Promise<SimpleOutput | undefined> {
    return { text: `pass:${input.text ?? ""}` };
  }
}

/**
 * Non-streaming consumer that needs a materialised text value.
 */
class SinkTask extends Task<SimpleInput, SimpleOutput> {
  public static type = "AccumTest_SinkTask";
  public static cacheable = false;

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", default: "" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async execute(input: any): Promise<SimpleOutput | undefined> {
    return { text: `sink:${input.text ?? ""}` };
  }
}

/**
 * Cacheable append-mode task for cache + accumulation tests.
 */
class CacheableAppendTask extends Task<SimpleInput, SimpleOutput> {
  public static type = "AccumTest_CacheableAppendTask";
  public static cacheable = true;

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { prompt: { type: "string" } },
      required: ["prompt"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
      required: ["text"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: SimpleInput,
    _context: IExecuteContext
  ): AsyncIterable<StreamEvent<SimpleOutput>> {
    yield { type: "text-delta", port: "text", textDelta: "cached" };
    yield { type: "text-delta", port: "text", textDelta: " value" };
    yield { type: "finish", data: {} as SimpleOutput };
  }

  async execute(_input: SimpleInput): Promise<SimpleOutput | undefined> {
    return { text: "cached value" };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function makeGraph(): { graph: TaskGraph; runner: TaskGraphRunner } {
  const graph = new TaskGraph();
  const runner = new TaskGraphRunner(graph);
  return { graph, runner };
}

// ============================================================================
// Tests
// ============================================================================

describe("Source-task streaming accumulation", () => {
  describe("TaskRunner: shouldAccumulate flag", () => {
    it("should emit enriched finish event when shouldAccumulate=true (default)", async () => {
      const task = new AppendTask({ prompt: "test" });
      const emitted: StreamEvent[] = [];
      task.on("stream_chunk", (e) => emitted.push(e));

      const result = await task.run({ prompt: "test" });

      // Text-deltas are emitted as-is
      expect(emitted.filter((e) => e.type === "text-delta").length).toBe(2);

      // Finish event should be enriched with accumulated text
      const finishEvent = emitted.find((e) => e.type === "finish");
      expect(finishEvent).toBeDefined();
      expect((finishEvent as any).data.text).toBe("hello world");

      // Final output is accumulated
      expect(result.text).toBe("hello world");
    });

    it("should NOT accumulate and emit raw finish when shouldAccumulate=false", async () => {
      // shouldAccumulate is passed via IRunConfig to TaskRunner.run(), not Task.run()
      // (Task.run() only accepts overrides; the graph runner uses runner.run() directly).
      const task = new AppendTask({ prompt: "test" });
      const emitted: StreamEvent[] = [];
      task.on("stream_chunk", (e) => emitted.push(e));

      const config: IRunConfig = { shouldAccumulate: false };
      const result = await task.runner.run({ prompt: "test" }, config);

      // Finish event should be the raw empty payload (no accumulation)
      const finishEvent = emitted.find((e) => e.type === "finish");
      expect(finishEvent).toBeDefined();
      expect((finishEvent as any).data).toEqual({});

      // finalOutput is also empty (raw finish from provider)
      expect(result.text).toBeUndefined();
    });

    it("should accumulate text-deltas for replace-mode task and enrich finish", async () => {
      // Replace-mode task with text-delta events (like HFT TextTranslation)
      const task = new ReplaceWithTextDeltasTask({ prompt: "test" });
      const emitted: StreamEvent[] = [];
      task.on("stream_chunk", (e) => emitted.push(e));

      const result = await task.run({ prompt: "test" });

      const finishEvent = emitted.find((e) => e.type === "finish");
      expect(finishEvent).toBeDefined();
      expect((finishEvent as any).data.text).toBe("Bonjour monde");

      expect(result.text).toBe("Bonjour monde");
    });

    it("should enrich finish by merging accumulated text into existing finish payload fields", async () => {
      // Task that produces both a text-delta field and other fields in finish
      class MixedFinishTask extends Task<SimpleInput, { text: string; lang: string }> {
        public static type = "AccumTest_MixedFinishTask";
        public static cacheable = false;

        public static inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: { prompt: { type: "string", default: "test" } },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        public static outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              text: { type: "string", "x-stream": "replace" },
              lang: { type: "string" },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        async *executeStream(
          _input: SimpleInput,
          _context: IExecuteContext
        ): AsyncIterable<StreamEvent<{ text: string; lang: string }>> {
          yield { type: "text-delta", port: "text", textDelta: "Hola" };
          yield { type: "text-delta", port: "text", textDelta: " mundo" };
          // finish carries lang but not text (like HFT_TextTranslation_Stream)
          yield { type: "finish", data: { lang: "es" } as any };
        }

        async execute(_input: SimpleInput): Promise<{ text: string; lang: string } | undefined> {
          return { text: "Hola mundo", lang: "es" };
        }
      }

      const task = new MixedFinishTask({ prompt: "test" });
      const emitted: StreamEvent[] = [];
      task.on("stream_chunk", (e) => emitted.push(e));

      const result = await task.run({ prompt: "test" });

      const finishEvent = emitted.find((e) => e.type === "finish");
      expect(finishEvent).toBeDefined();
      // Both accumulated text AND the original lang field should be present
      expect((finishEvent as any).data.text).toBe("Hola mundo");
      expect((finishEvent as any).data.lang).toBe("es");

      expect((result as any).text).toBe("Hola mundo");
      expect((result as any).lang).toBe("es");
    });
  });

  describe("TaskGraphRunner: taskNeedsAccumulation", () => {
    it("should accumulate when source connects to a non-streaming downstream", async () => {
      const { graph, runner } = makeGraph();

      const source = new AppendTask({ prompt: "test" }, { id: "source" });
      const sink = new SinkTask({} as any, { id: "sink" });

      graph.addTasks([source, sink]);
      graph.addDataflow(new Dataflow("source", "text", "sink", "text"));

      const emittedFinish: StreamEvent[] = [];
      source.on("stream_chunk", (e) => {
        if (e.type === "finish") emittedFinish.push(e);
      });

      const results = await runner.runGraph({ prompt: "test" });

      // Source task should have been told to accumulate (enriched finish)
      expect(emittedFinish.length).toBe(1);
      expect((emittedFinish[0] as any).data.text).toBe("hello world");

      // Downstream sink should receive the accumulated value
      const sinkResult = results.find((r) => r.id === "sink");
      expect(sinkResult).toBeDefined();
      expect((sinkResult!.data as any).text).toBe("sink:hello world");
    });

    it("should NOT accumulate when all downstream edges connect to streaming tasks", async () => {
      const { graph, runner } = makeGraph();

      const source = new AppendTask({ prompt: "test" }, { id: "source" });
      const passThroughA = new StreamPassThroughTask({} as any, { id: "pass-a" });
      const passThroughB = new StreamPassThroughTask({} as any, { id: "pass-b" });

      graph.addTasks([source, passThroughA, passThroughB]);
      // Both downstream tasks accept streaming input (x-stream: "append")
      graph.addDataflow(new Dataflow("source", "text", "pass-a", "text"));
      graph.addDataflow(new Dataflow("source", "text", "pass-b", "text"));

      const emittedBySource: StreamEvent[] = [];
      source.on("stream_chunk", (e) => emittedBySource.push(e));

      await runner.runGraph({ prompt: "test" });

      // Source should have emitted raw finish (no accumulation needed)
      const finishEvent = emittedBySource.find((e) => e.type === "finish");
      expect(finishEvent).toBeDefined();
      // Raw finish from provider is empty {}
      expect((finishEvent as any).data).toEqual({});
    });

    it("should accumulate when even one downstream is non-streaming (fan-out)", async () => {
      const { graph, runner } = makeGraph();

      const source = new AppendTask({ prompt: "test" }, { id: "source" });
      const passThrough = new StreamPassThroughTask({} as any, { id: "stream-down" });
      const sink = new SinkTask({} as any, { id: "sink" });

      graph.addTasks([source, passThrough, sink]);
      graph.addDataflow(new Dataflow("source", "text", "stream-down", "text"));
      graph.addDataflow(new Dataflow("source", "text", "sink", "text"));

      const emittedFinish: StreamEvent[] = [];
      source.on("stream_chunk", (e) => {
        if (e.type === "finish") emittedFinish.push(e);
      });

      const results = await runner.runGraph({ prompt: "test" });

      // Source must accumulate because sink is non-streaming
      expect((emittedFinish[0] as any).data.text).toBe("hello world");

      // Sink receives the accumulated value
      const sinkResult = results.find((r) => r.id === "sink");
      expect((sinkResult!.data as any).text).toBe("sink:hello world");
    });
  });

  describe("Graph execution: replace-mode with text-deltas (HFT TextTranslation scenario)", () => {
    it("should materialise correct text for replace-mode task with text-delta events", async () => {
      const { graph, runner } = makeGraph();

      const source = new ReplaceWithTextDeltasTask({ prompt: "hello" }, { id: "source" });
      const sink = new SinkTask({} as any, { id: "sink" });

      graph.addTasks([source, sink]);
      graph.addDataflow(new Dataflow("source", "text", "sink", "text"));

      const results = await runner.runGraph({ prompt: "hello" });

      expect(source.status).toBe(TaskStatus.COMPLETED);
      expect(sink.status).toBe(TaskStatus.COMPLETED);

      // Sink should have received "Bonjour monde" (accumulated from text-deltas)
      const sinkResult = results.find((r) => r.id === "sink");
      expect(sinkResult).toBeDefined();
      expect((sinkResult!.data as any).text).toBe("sink:Bonjour monde");
    });
  });

  describe("Graph execution: multiple non-streaming consumers (fan-out)", () => {
    it("should provide identical accumulated data to all non-streaming downstream tasks", async () => {
      const { graph, runner } = makeGraph();

      const source = new AppendTask({ prompt: "test" }, { id: "source" });
      const sinkA = new SinkTask({} as any, { id: "sink-a" });
      const sinkB = new SinkTask({} as any, { id: "sink-b" });

      graph.addTasks([source, sinkA, sinkB]);
      graph.addDataflow(new Dataflow("source", "text", "sink-a", "text"));
      graph.addDataflow(new Dataflow("source", "text", "sink-b", "text"));

      const results = await runner.runGraph({ prompt: "test" });

      // Both sinks should receive the same accumulated value via tee'd enriched finish
      const resultA = results.find((r) => r.id === "sink-a");
      const resultB = results.find((r) => r.id === "sink-b");

      expect(resultA).toBeDefined();
      expect(resultB).toBeDefined();
      expect((resultA!.data as any).text).toBe("sink:hello world");
      expect((resultB!.data as any).text).toBe("sink:hello world");
    });
  });

  describe("Cache auto-enables accumulation", () => {
    let cache: InMemoryTaskOutputRepository;

    beforeEach(async () => {
      cache = new InMemoryTaskOutputRepository();
      await cache.setupDatabase();
    });

    it("should accumulate when cache is active even with only streaming downstream", async () => {
      // Graph: source -> streamPassThrough. Normally shouldAccumulate=false (all streaming).
      // But cache is on so source must accumulate to have data to save.
      const { graph, runner } = makeGraph();

      const source = new CacheableAppendTask({ prompt: "test" }, { id: "source" });
      const passThrough = new StreamPassThroughTask({} as any, { id: "pass" });

      graph.addTasks([source, passThrough]);
      graph.addDataflow(new Dataflow("source", "text", "pass", "text"));

      const emittedFinish: StreamEvent[] = [];
      source.on("stream_chunk", (e) => {
        if (e.type === "finish") emittedFinish.push(e);
      });

      await runner.runGraph({ prompt: "test" }, { outputCache: cache });

      // Source should have accumulated because cache is on
      expect(emittedFinish.length).toBe(1);
      expect((emittedFinish[0] as any).data.text).toBe("cached value");

      // Cached output should contain the accumulated text
      const cached = await cache.getOutput("AccumTest_CacheableAppendTask", { prompt: "test" });
      expect(cached).toBeDefined();
      expect((cached as any).text).toBe("cached value");
    });

    it("should cache accumulated result and serve it on second run", async () => {
      const task1 = new CacheableAppendTask({ prompt: "hello" }, { outputCache: cache });
      const result1 = await task1.run({ prompt: "hello" });
      expect(result1.text).toBe("cached value");

      // Second run: should hit cache
      const task2 = new CacheableAppendTask({ prompt: "hello" }, { outputCache: cache });
      const events: StreamEvent[] = [];
      task2.on("stream_chunk", (e) => events.push(e));

      const result2 = await task2.run({ prompt: "hello" });

      // Cache hit emits a single finish event with the cached data
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("finish");
      expect((events[0] as any).data.text).toBe("cached value");
      expect(result2.text).toBe("cached value");
    });
  });
});
