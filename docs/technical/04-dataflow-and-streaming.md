<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Dataflow and Streaming

## Overview

In Workglow's task graph engine, edges between tasks are not passive wires. They are first-class `Dataflow` objects that carry typed data, track their own lifecycle status, validate schema compatibility between source and target ports, emit events, and -- when the upstream task supports streaming -- hold a `ReadableStream<StreamEvent>` that delivers incremental output to downstream consumers in real time.

This architecture solves a fundamental problem in DAG-based pipeline frameworks: how to support streaming data (LLM token generation, progressive image refinement, structured object construction) without breaking the contract that downstream tasks expect a complete value. Workglow achieves this through a layered design: schema annotations declare streaming behavior per port, the `TaskRunner` accumulates deltas when needed, the `TaskGraphRunner` propagates streams across edges with fan-out via `tee()`, and the `Dataflow` object materializes the final value once the stream completes.

All streaming types and helpers live in `packages/task-graph/src/task/StreamTypes.ts`. The `Dataflow` class lives in `packages/task-graph/src/task-graph/Dataflow.ts`.

---

## The Dataflow Class

A `Dataflow` represents a single edge in the task graph, connecting one output port of a source task to one input port of a target task.

### Constructor

```ts
class Dataflow {
  constructor(
    public sourceTaskId: TaskIdType,
    public sourceTaskPortId: string,
    public targetTaskId: TaskIdType,
    public targetTaskPortId: string
  ) {}
}
```

The four parameters define the edge's endpoints: which task and which port on each side. The dataflow's `id` is derived from these coordinates as a human-readable arrow string.

### Identity

The static `Dataflow.createId()` method and the instance `id` getter produce a deterministic string identifier:

```ts
Dataflow.createId("gen-1", "text", "rewrite-1", "text");
// => "gen-1[text] ==> rewrite-1[text]"
```

This format is also the basis for `DataflowIdType`, a template literal type that enforces the pattern at the type level. The convenience subclass `DataflowArrow` parses such a string back into a `Dataflow` instance.

### Value and Status

Each dataflow tracks the data flowing through it and the current execution state:

- **`value: any`** -- The materialized data for this edge, set when the source task completes or when a stream is consumed to completion.
- **`status: TaskStatus`** -- Mirrors the lifecycle of the source task's execution through this edge: `PENDING`, `PROCESSING`, `STREAMING`, `COMPLETED`, `FAILED`, `DISABLED`, or `ABORTING`.
- **`error: TaskError | undefined`** -- Populated when the edge transitions to `FAILED`.

Status transitions emit events through the dataflow's event system (`start`, `streaming`, `complete`, `abort`, `reset`, `error`, `disabled`, `status`).

### Stream

```ts
public stream: ReadableStream<StreamEvent> | undefined = undefined;
```

When the upstream task begins producing streaming output, the `TaskGraphRunner` attaches a `ReadableStream<StreamEvent>` to the dataflow. This stream carries incremental events (text deltas, object deltas, snapshots) and terminates with a `finish` or `error` event. Multiple downstream consumers each receive an independent copy of the stream via `tee()`.

---

## Port System

Workglow tasks declare their input and output shapes as JSON Schema objects (`DataPortSchema`). Each top-level property in the schema represents a **port**. Dataflows connect a specific output port on one task to a specific input port on another.

Two special port identifiers exist:

- **`"*"` (`DATAFLOW_ALL_PORTS`)** -- Captures the entire output (or provides the entire input) as a single value, bypassing per-property routing.
- **`"[error]"` (`DATAFLOW_ERROR_PORT`)** -- Routes error data from a failed task to a downstream error handler.

When a dataflow's source port is a named property, `setPortData(entireDataBlock)` extracts `entireDataBlock[sourceTaskPortId]` and stores it in `value`. When the target port is a named property, `getPortData()` wraps the value back into `{ [targetTaskPortId]: value }`. This symmetric extraction/wrapping allows the graph runner to assemble a task's full input by merging `getPortData()` results from all incoming edges.

### Semantic Compatibility

Before data flows, the `semanticallyCompatible()` method validates that the source output port and target input port have compatible types. It inspects the JSON Schema properties on both endpoints and returns:

- `"static"` -- Types match at construction time.
- `"runtime"` -- Compatible but requires runtime narrowing.
- `"incompatible"` -- The connection is invalid.

Results are cached for tasks with stable (non-dynamic) schemas and invalidated when a task emits a `schemaChange` event.

---

## Stream Modes

Stream modes declare how a task's streaming output should be interpreted. Each mode corresponds to a different contract between producer and consumer.

### `"none"` (Default)

The task does not stream. `execute()` returns `Promise<Output>` and the dataflow receives a complete value.

### `"append"`

Each chunk is a delta -- a new piece of text to concatenate onto what came before. This is the natural mode for LLM token streaming. AI tasks such as `TextGenerationTask`, `TextSummaryTask`, and `TextRewriterTask` use append mode on their text output ports.

```ts
{
  type: "string",
  title: "Text",
  "x-stream": "append",
}
```

### `"replace"`

Each chunk is a corrected, revised snapshot of the complete output so far. The consumer does not concatenate; it overwrites. This is the right mode for translation, where early chunks are rough approximations that get refined. `TextTranslationTask` uses replace mode.

```ts
{
  type: "string",
  title: "Text",
  "x-stream": "replace",
}
```

### `"object"`

Each chunk is a progressively more complete partial object. Consumers should replace (not merge) their state with the latest delta. This mode is designed for structured generation where an LLM produces JSON conforming to a schema. `StructuredGenerationTask` uses object mode.

```ts
{
  type: "object",
  title: "Structured Output",
  "x-stream": "object",
  "x-structured-output": true,
  additionalProperties: true,
}
```

### `"mixed"`

Automatically detected when different output ports on the same task use different stream modes. For example, a task streaming `text` in append mode and `toolCalls` in object mode simultaneously. This mode is never declared directly; the `getOutputStreamMode()` function returns it when it discovers heterogeneous port annotations.

---

## StreamEvent Types

All streaming communication uses a single discriminated union type, `StreamEvent<Output>`. Each variant serves a specific purpose within the streaming protocol.

### `StreamTextDelta`

```ts
type StreamTextDelta = {
  type: "text-delta";
  port: string;
  textDelta: string;
};
```

Carries a single token or text fragment for append-mode streaming. The `port` field identifies which output port the delta belongs to. The `TaskRunner` accumulates these into a complete string when `shouldAccumulate` is true.

### `StreamObjectDelta`

```ts
type StreamObjectDelta = {
  type: "object-delta";
  port: string;
  objectDelta: Record<string, unknown> | unknown[];
};
```

Carries a progressively more complete partial object for object-mode streaming. Each delta replaces (not merges with) the previous state. The `TaskRunner` tracks the latest delta per port when accumulating.

### `StreamSnapshot`

```ts
type StreamSnapshot<Output> = {
  type: "snapshot";
  data: Output;
};
```

Carries a full replacement of the current output state for replace-mode streaming. The `Dataflow.awaitStreamValue()` method gives snapshot data priority over finish data when materializing values, since the last snapshot represents the most recent complete state.

### `StreamFinish`

```ts
type StreamFinish<Output> = {
  type: "finish";
  data: Output;
};
```

Signals that the stream has completed. When the `TaskRunner` has accumulated deltas, it emits an enriched finish event with the accumulated data merged into `data`. When accumulation is off, providers emit the raw finish event (typically with `{} as Output`). This is the primary materialization path for `awaitStreamValue()`.

### `StreamError`

```ts
type StreamError = {
  type: "error";
  error: Error;
};
```

Signals a fatal error in the stream. When `awaitStreamValue()` encounters this event, it sets the dataflow to `FAILED` status and throws the error.

---

## The `x-stream` Schema Annotation

The `x-stream` extension property on individual port properties in a task's JSON Schema is the single source of truth for streaming behavior:

```ts
export const TextGenerationOutputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      "x-stream": "append",
    },
  },
  required: ["text"],
} as const satisfies DataPortSchema;
```

A task is considered streamable when two conditions are met: at least one output port has an `x-stream` annotation, and the task class implements the `executeStream()` method. The `isTaskStreamable()` helper checks both conditions.

This schema-driven approach means streaming behavior is declarative. A task author annotates their output schema and implements `executeStream()`. The framework handles stream creation, fan-out, accumulation, and materialization automatically.

---

## Stream Lifecycle

### `setStream(stream)`

```ts
public setStream(stream: ReadableStream<StreamEvent>): void
```

Called by the `TaskGraphRunner` to attach a stream to a dataflow edge. The `pushStreamToEdges()` method creates `ReadableStream` instances from task events via `createStreamFromTaskEvents()`, then assigns them to outgoing edges.

### `getStream()`

```ts
public getStream(): ReadableStream<StreamEvent> | undefined
```

Returns the active stream on this dataflow, or `undefined` if the edge is not currently streaming. Downstream tasks can use this to check whether streaming data is available.

### `awaitStreamValue()`

```ts
public async awaitStreamValue(): Promise<void>
```

Consumes the active stream to completion and materializes the final value on the dataflow. This method reads all events from the stream, handling three event types:

- **`snapshot`** -- Stores the data as `lastSnapshotData` (used for replace-mode tasks).
- **`finish`** -- Stores the data as `finishData` (the primary materialization path for append/object modes).
- **`error`** -- Stores the error, sets the dataflow to `FAILED`, and throws.

Text-delta and object-delta events are ignored because the source task has already accumulated them into the enriched finish event. After consumption, the stream reference is cleared. The materialization priority is snapshot over finish, since the last snapshot in replace mode represents the most current complete state.

### Fan-Out with `tee()`

When a streaming task feeds multiple downstream consumers, the `pushStreamToEdges()` method groups outgoing dataflows by source port and uses the Web Streams API `tee()` to split each stream:

```ts
for (const [portKey, edges] of groups) {
  const stream = this.createStreamFromTaskEvents(task, filterPort);

  if (edges.length === 1) {
    edges[0].setStream(stream);
  } else {
    let currentStream = stream;
    for (let i = 0; i < edges.length; i++) {
      if (i === edges.length - 1) {
        edges[i].setStream(currentStream);
      } else {
        const [s1, s2] = currentStream.tee();
        edges[i].setStream(s1);
        currentStream = s2;
      }
    }
  }
}
```

Each downstream edge gets an independent reader. One consumer reading slowly does not block another from reading quickly. Because `tee()` is part of the standard Web Streams API, this works identically across browsers, Node.js, and Bun.

### `reset()`

```ts
public reset(): void
```

Clears the dataflow back to its initial state: status returns to `PENDING`, value and error are set to `undefined`, the stream reference is cleared, and the compatibility cache is invalidated.

---

## Delta Accumulation Responsibility

One of the most important architectural decisions in the streaming system is the strict separation between **providers** (which yield deltas) and the **TaskRunner** (which accumulates them).

### Providers Are Stateless

AI provider stream functions yield incremental events and a final `finish` event with an empty data payload:

```ts
// Provider yields deltas without tracking state
yield { type: "text-delta", port: "text", textDelta: "Hello" };
yield { type: "text-delta", port: "text", textDelta: " world" };
yield { type: "finish", data: {} as TextGenerationTaskOutput };
```

Providers never accumulate, never track how many tokens have been emitted, and never build the complete output string. They yield deltas and a termination signal. This keeps providers simple, testable, and free of double-buffering bugs.

### The TaskRunner Accumulates When Needed

The `TaskRunner.executeStreamingTask()` method decides whether to accumulate based on a `shouldAccumulate` flag, computed by the `TaskGraphRunner` from the graph topology. Accumulation is needed when:

- Output caching is active (the cached value must be fully materialized).
- Any downstream edge connects to an input port that does not accept the same stream mode.

When accumulating, the runner maintains `Map<string, string>` for text deltas and `Map<string, Record<string, unknown> | unknown[]>` for object deltas. On the `finish` event, it merges the accumulated data into an enriched finish event:

```ts
const merged: Record<string, unknown> = { ...(event.data || {}) };
for (const [port, text] of accumulated) {
  if (text.length > 0) merged[port] = text;
}
finalOutput = merged as unknown as Output;
this.task.emit("stream_chunk", { type: "finish", data: merged });
```

Because all downstream edges share the enriched event through tee'd streams, no edge needs to re-accumulate independently. The `Dataflow.awaitStreamValue()` method reads the finish event's `data` field and sets it as the edge's materialized value.

### Edge-Level Accumulation Detection

The `edgeNeedsAccumulation()` helper determines whether a specific edge requires accumulation by comparing the source and target port stream modes:

```ts
function edgeNeedsAccumulation(
  sourceSchema: DataPortSchema,
  sourcePort: string,
  targetSchema: DataPortSchema,
  targetPort: string
): boolean {
  const sourceMode = getPortStreamMode(sourceSchema, sourcePort);
  if (sourceMode === "none") return false;
  const targetMode = getPortStreamMode(targetSchema, targetPort);
  return sourceMode !== targetMode;
}
```

When the source port streams but the target port does not declare the same stream mode, the edge needs a materialized value -- triggering accumulation at the runner level.

---

## API Reference

### Dataflow

| Member | Signature | Description |
|---|---|---|
| `constructor` | `(sourceTaskId, sourceTaskPortId, targetTaskId, targetTaskPortId)` | Creates a dataflow edge between two task ports |
| `id` | `get id(): DataflowIdType` | Returns the deterministic string ID in `source[port] ==> target[port]` format |
| `createId` | `static createId(sourceTaskId, sourceTaskPortId, targetTaskId, targetTaskPortId): DataflowIdType` | Static factory for dataflow IDs |
| `value` | `any` | The materialized data for this edge |
| `status` | `TaskStatus` | Current lifecycle status of the edge |
| `stream` | `ReadableStream<StreamEvent> \| undefined` | Active stream when the source task is streaming |
| `setStream` | `(stream: ReadableStream<StreamEvent>): void` | Attaches a stream to this edge |
| `getStream` | `(): ReadableStream<StreamEvent> \| undefined` | Returns the active stream or undefined |
| `awaitStreamValue` | `(): Promise<void>` | Consumes the stream to completion and materializes the value |
| `setPortData` | `(entireDataBlock: any): void` | Extracts this edge's value from the source task's full output |
| `getPortData` | `(): TaskOutput` | Wraps the value into the target task's input shape |
| `setStatus` | `(status: TaskStatus): void` | Updates status and emits the corresponding event |
| `reset` | `(): void` | Clears all state back to `PENDING` |
| `semanticallyCompatible` | `(graph, dataflow): "static" \| "runtime" \| "incompatible"` | Validates type compatibility between source and target ports |
| `invalidateCompatibilityCache` | `(): void` | Forces recomputation of the compatibility check |

### StreamTypes Helpers

| Function | Signature | Description |
|---|---|---|
| `getPortStreamMode` | `(schema: DataPortSchema \| JsonSchema, portId: string): StreamMode` | Returns the stream mode for a single port (`"none"` if absent) |
| `getStreamingPorts` | `(schema: DataPortSchema): Array<{ port: string; mode: StreamMode }>` | Returns all ports with `x-stream` annotations |
| `getOutputStreamMode` | `(outputSchema: DataPortSchema): StreamMode` | Returns the dominant output stream mode or `"mixed"` |
| `isTaskStreamable` | `(task): boolean` | Checks both schema annotations and `executeStream()` implementation |
| `edgeNeedsAccumulation` | `(sourceSchema, sourcePort, targetSchema, targetPort): boolean` | Determines if an edge needs the runner to accumulate |
| `getAppendPortId` | `(schema: DataPortSchema): string \| undefined` | Finds the first port with `x-stream: "append"` |
| `getObjectPortId` | `(schema: DataPortSchema): string \| undefined` | Finds the first port with `x-stream: "object"` |
| `getStructuredOutputSchemas` | `(schema: DataPortSchema): Map<string, JsonSchema>` | Returns schemas for all ports with `x-structured-output: true` |
| `hasStructuredOutput` | `(schema: DataPortSchema): boolean` | Checks if any port declares structured output |
