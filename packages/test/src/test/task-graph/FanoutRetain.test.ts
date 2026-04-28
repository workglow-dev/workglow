/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, test, beforeEach } from "vitest";
import {
  Dataflow,
  Task,
  TaskGraph,
  registerRefcountablePredicate,
  _resetRefcountablePredicatesForTests,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";

class FakeRefcounted {
  count = 1;
  retain(n: number = 1): this { this.count += n; return this; }
  release(): void { this.count -= 1; }
}

class SourceTask extends Task<{}, { v: FakeRefcounted }> {
  static override readonly type = "FanoutSourceTask";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema { return { type: "object", properties: {} } as const satisfies DataPortSchema; }
  static override outputSchema(): DataPortSchema { return { type: "object", properties: { v: { type: "object" } } } as const satisfies DataPortSchema; }
  readonly produced = new FakeRefcounted();
  override async execute() {
    return { v: this.produced };
  }
}

class SinkTask extends Task<{ v: FakeRefcounted }, {}> {
  static override readonly type = "FanoutSinkTask";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema { return { type: "object", properties: { v: { type: "object" } } } as const satisfies DataPortSchema; }
  static override outputSchema(): DataPortSchema { return { type: "object", properties: {} } as const satisfies DataPortSchema; }
  override async execute(_input: { v: FakeRefcounted }) {
    return {};
  }
}

describe("TaskGraphRunner fanout retain", () => {
  beforeEach(() => {
    _resetRefcountablePredicatesForTests();
    registerRefcountablePredicate(
      (v): v is FakeRefcounted => v instanceof FakeRefcounted,
    );
  });

  test("output with 2 consumers gets retain(1) at publish time", async () => {
    const source = new SourceTask({ id: "src" });
    const sinkA = new SinkTask({ id: "sinkA" });
    const sinkB = new SinkTask({ id: "sinkB" });

    const graph = new TaskGraph();
    graph.addTask(source);
    graph.addTask(sinkA);
    graph.addTask(sinkB);
    graph.addDataflow(new Dataflow(source.id as string, "v", sinkA.id as string, "v"));
    graph.addDataflow(new Dataflow(source.id as string, "v", sinkB.id as string, "v"));

    await graph.run();

    // After source.execute(), the value's refcount should have been
    // bumped by (consumerCount - 1) = 1, so total refs = 2.
    expect(source.produced.count).toBe(2);
  });

  test("output with 1 consumer is not retained", async () => {
    const source = new SourceTask({ id: "src" });
    const sink = new SinkTask({ id: "sink" });

    const graph = new TaskGraph();
    graph.addTask(source);
    graph.addTask(sink);
    graph.addDataflow(new Dataflow(source.id as string, "v", sink.id as string, "v"));

    await graph.run();
    expect(source.produced.count).toBe(1); // no retain
  });

  test("non-refcountable values are passed through unchanged", async () => {
    // Without registering a predicate matching the produced value, even
    // fanned-out outputs don't trigger retain (no methods to call anyway).
    _resetRefcountablePredicatesForTests();
    const source = new SourceTask({ id: "src" });
    const sinkA = new SinkTask({ id: "sinkA" });
    const sinkB = new SinkTask({ id: "sinkB" });

    const graph = new TaskGraph();
    graph.addTask(source);
    graph.addTask(sinkA);
    graph.addTask(sinkB);
    graph.addDataflow(new Dataflow(source.id as string, "v", sinkA.id as string, "v"));
    graph.addDataflow(new Dataflow(source.id as string, "v", sinkB.id as string, "v"));

    await graph.run();
    expect(source.produced.count).toBe(1); // predicate not registered, no retain
  });
});
