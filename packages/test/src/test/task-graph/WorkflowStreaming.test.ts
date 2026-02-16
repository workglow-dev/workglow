/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Dataflow,
  IExecuteContext,
  Task,
  Workflow,
  type StreamEvent,
  type StreamMode,
  type TaskIdType,
} from "@workglow/task-graph";
import { DataPortSchema, sleep } from "@workglow/util";
import { describe, expect, it } from "vitest";

// ============================================================================
// Test Tasks
// ============================================================================

type TextInput = { prompt: string };
type TextOutput = { text: string };

class WFStreamSource extends Task<TextInput, TextOutput> {
  public static type = "WFStreamSource";
  public static streamable = true;
  public static streamMode: StreamMode = "append";
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
      properties: { text: { type: "string" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  async *executeStream(
    _input: TextInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<TextOutput>> {
    yield { type: "text-delta", textDelta: "alpha" };
    await sleep(5);
    yield { type: "text-delta", textDelta: " beta" };
    yield { type: "finish", data: { text: "alpha beta" } };
  }

  async execute(_input: TextInput): Promise<TextOutput | undefined> {
    return { text: "alpha beta" };
  }
}

class WFNonStreamSink extends Task<{ text: string }, TextOutput> {
  public static type = "WFNonStreamSink";
  public static streamable = false;
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

  async execute(input: any): Promise<TextOutput | undefined> {
    return { text: `result: ${input.text || ""}` };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("Workflow Streaming Events", () => {
  it("should emit stream_start on the workflow when a task begins streaming", async () => {
    const workflow = new Workflow();

    const source = new WFStreamSource({ prompt: "hi" }, { id: "src" });
    const sink = new WFNonStreamSink({} as any, { id: "sink" });

    workflow.graph.addTasks([source, sink]);
    workflow.graph.addDataflow(new Dataflow("src", "text", "sink", "text"));

    const starts: TaskIdType[] = [];
    workflow.events.on("stream_start", (taskId) => starts.push(taskId));

    await workflow.run({ prompt: "hi" } as any);

    expect(starts).toContain("src");
    expect(starts.length).toBe(1);
  });

  it("should emit stream_chunk on the workflow for each chunk", async () => {
    const workflow = new Workflow();

    const source = new WFStreamSource({ prompt: "hi" }, { id: "src" });
    const sink = new WFNonStreamSink({} as any, { id: "sink" });

    workflow.graph.addTasks([source, sink]);
    workflow.graph.addDataflow(new Dataflow("src", "text", "sink", "text"));

    const chunks: { taskId: TaskIdType; event: StreamEvent }[] = [];
    workflow.events.on("stream_chunk", (taskId, event) => {
      chunks.push({ taskId, event });
    });

    await workflow.run({ prompt: "hi" } as any);

    const textDeltas = chunks.filter((c) => c.event.type === "text-delta");
    expect(textDeltas.length).toBe(2);
    expect((textDeltas[0].event as any).textDelta).toBe("alpha");
    expect((textDeltas[1].event as any).textDelta).toBe(" beta");
  });

  it("should emit stream_end on the workflow when streaming finishes", async () => {
    const workflow = new Workflow();

    const source = new WFStreamSource({ prompt: "hi" }, { id: "src" });
    const sink = new WFNonStreamSink({} as any, { id: "sink" });

    workflow.graph.addTasks([source, sink]);
    workflow.graph.addDataflow(new Dataflow("src", "text", "sink", "text"));

    const ends: { taskId: TaskIdType; output: Record<string, any> }[] = [];
    workflow.events.on("stream_end", (taskId, output) => {
      ends.push({ taskId, output });
    });

    await workflow.run({ prompt: "hi" } as any);

    expect(ends.length).toBe(1);
    expect(ends[0].taskId).toBe("src");
    expect(ends[0].output).toEqual({ text: "alpha beta" });
  });

  it("should clean up streaming subscriptions after workflow completes", async () => {
    const workflow = new Workflow();

    const source = new WFStreamSource({ prompt: "hi" }, { id: "src" });
    workflow.graph.addTasks([source]);

    const starts: TaskIdType[] = [];
    workflow.events.on("stream_start", (taskId) => starts.push(taskId));

    // First run
    await workflow.run({ prompt: "hi" } as any);
    expect(starts.length).toBe(1);

    // Reset and run again
    workflow.reset();
    const source2 = new WFStreamSource({ prompt: "hi" }, { id: "src2" });
    workflow.graph.addTasks([source2]);

    starts.length = 0;
    await workflow.run({ prompt: "hi" } as any);

    // Should only see events from the second run
    expect(starts).toContain("src2");
  });

  it("should clean up streaming subscriptions after workflow errors", async () => {
    const workflow = new Workflow();

    class FailingStreamTask extends Task<TextInput, TextOutput> {
      public static type = "FailingStreamTask";
      public static streamable = true;
      public static streamMode: StreamMode = "append";
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
          properties: { text: { type: "string" } },
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }

      async *executeStream(
        _input: TextInput,
        context: IExecuteContext
      ): AsyncIterable<StreamEvent<TextOutput>> {
        yield { type: "text-delta", textDelta: "before error" };
        yield { type: "error", error: new Error("stream failed") };
      }

      async execute(_input: TextInput): Promise<TextOutput | undefined> {
        throw new Error("stream failed");
      }
    }

    const failTask = new FailingStreamTask({ prompt: "hi" }, { id: "fail" });
    workflow.graph.addTasks([failTask]);

    const errors: string[] = [];
    workflow.events.on("error", (err) => errors.push(err));

    try {
      await workflow.run({ prompt: "hi" } as any);
    } catch {
      // Expected
    }

    expect(errors.length).toBeGreaterThan(0);
  });

  it("should propagate events from multiple streaming tasks", async () => {
    const workflow = new Workflow();

    const source1 = new WFStreamSource({ prompt: "hi" }, { id: "src1" });
    const source2 = new WFStreamSource({ prompt: "hi" }, { id: "src2" });

    workflow.graph.addTasks([source1, source2]);

    const starts: TaskIdType[] = [];
    workflow.events.on("stream_start", (taskId) => starts.push(taskId));

    await workflow.run({ prompt: "hi" } as any);

    // Both streaming tasks should trigger stream_start
    expect(starts).toContain("src1");
    expect(starts).toContain("src2");
  });
});
