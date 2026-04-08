<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Dataflow and Streaming Architecture in Workglow

**How typed edges, stream modes, and delta accumulation make real-time AI pipelines possible**

---

Most DAG-based pipeline frameworks treat edges as dumb wires. Data goes in one end, comes out the other, and the framework considers its job done. That works fine when every node produces a complete value before its successors start. But the moment you introduce streaming -- LLM token generation, progressive image refinement, live sensor feeds -- you discover that "dumb wire" is nowhere near sufficient.

Workglow's `task-graph` package takes a different approach. Edges are first-class objects with their own schemas, lifecycle states, and (when streaming is active) `ReadableStream` instances that carry typed events through the graph in real time. This post dives into how that works, from the schema annotations that declare streaming behavior, through the stream event types that flow across edges, to the accumulation strategy that keeps providers stateless and downstream consumers well-fed.

## Dataflows as Typed Edges

In Workglow, the connection between two tasks is not a simple pointer. It is a `Dataflow` object with four coordinates:

```
sourceTaskId[sourceTaskPortId] ==> targetTaskId[targetTaskPortId]
```

That string is literally the dataflow's ID -- a human-readable arrow that tells you exactly which output port feeds which input port. A `TextGenerationTask` might have a `text` output port connected to a `TextRewriterTask`'s `text` input port, and the dataflow ID reads: `gen-1[text] ==> rewrite-1[text]`.

But naming is just the beginning. Every dataflow validates **semantic compatibility** between the source output schema and the target input schema. The `semanticallyCompatible()` method inspects the JSON Schema properties on both ends and returns one of three verdicts: `"static"` (types match at construction time), `"runtime"` (needs narrowing at execution time), or `"incompatible"` (this edge should never have been drawn). Compatibility results are cached for tasks with stable schemas and invalidated when a task emits a `schemaChange` event.

This means that when you connect two tasks in a Workglow graph, the framework knows -- before a single byte of data flows -- whether the connection makes sense. The schema system catches mismatches like connecting a numeric output to a string input, or wiring a vector embedding port to a plain-text port. It is type safety for data pipelines, enforced at the edge level.

Each dataflow also carries its own `status`, tracking the lifecycle of the data moving through it: `PENDING`, `PROCESSING`, `STREAMING`, `COMPLETED`, `FAILED`, `DISABLED`. When a `ConditionalTask` decides which branch to activate, inactive branch dataflows transition to `DISABLED`, and that status cascades through the downstream subgraph. Edges are not passive conduits; they are active participants in the execution model.

## The Three Stream Modes

Not all streaming is created equal. A chat model emits tokens one at a time (each token extends the previous output). A translation model might revise its entire output with each new chunk (replacing the previous best guess). A structured generation model progressively builds a JSON object, with each delta being a more complete snapshot of the final structure. Workglow captures these three patterns as distinct **stream modes**, declared per-port via the `x-stream` JSON Schema extension:

### Append Mode (`"append"`)

Each chunk is a delta -- a new piece of text to concatenate onto what came before. This is the natural mode for LLM token streaming:

```ts
const generatedTextSchema = {
  type: "string",
  title: "Text",
  description: "The generated text",
  "x-stream": "append",
} as const;
```

The `TextGenerationTask`, `TextSummaryTask`, `TextRewriterTask`, and `AgentTask` all use append mode on their text output ports. When you see tokens appearing one by one in a chat UI, that is append-mode streaming at work.

### Replace Mode (`"replace"`)

Each chunk is a corrected, revised snapshot that replaces the previous state entirely. This is the right mode for translation, where early chunks might be rough approximations that get refined:

```ts
const translationTextSchema = {
  type: "string",
  title: "Text",
  description: "The translated text",
  "x-stream": "replace",
} as const;
```

The `TextTranslationTask` uses replace mode. The consumer does not concatenate; it overwrites. Each snapshot is the current best answer.

### Object Mode (`"object"`)

Each chunk is a progressively more complete partial object. This is designed for structured generation, where an LLM is producing JSON that conforms to a schema, and you want to show the object as it fills in:

```ts
{
  type: "object",
  title: "Structured Output",
  description: "The generated structured object",
  "x-stream": "object",
  "x-structured-output": true,
  additionalProperties: true,
}
```

The `StructuredGenerationTask` and the `ToolCallingTask` (for its tool arguments) use object mode. Consumers replace their state with each new `objectDelta` rather than merging.

There is also a `"mixed"` mode, automatically detected when different output ports on the same task use different stream modes -- such as the `ToolCallingTask`, which streams `text` in append mode and `toolCalls` in object mode simultaneously.

## ReadableStream on Edges

Here is where the architecture gets interesting. When a streaming task begins producing output, the `TaskGraphRunner` does not simply buffer events and replay them later. Instead, it creates a `ReadableStream<StreamEvent>` and attaches it directly to the outgoing dataflow edge.

The stream is created from task events via `createStreamFromTaskEvents()`, which listens for the task's `stream_chunk` and `stream_end` events and enqueues them into a `ReadableStream` controller. When a specific port is targeted (rather than `DATAFLOW_ALL_PORTS`), the stream filters delta events to only those matching the port while still passing through control events like `finish` and `error`.

### Fan-Out with tee()

A single streaming task might feed multiple downstream consumers. The `pushStreamToEdges()` method handles this by grouping outgoing dataflows by their source port, then using the Web Streams API's `tee()` to split the stream:

```ts
// Simplified from TaskGraphRunner.pushStreamToEdges()
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

Each downstream edge gets its own independent reader. One consumer reading slowly does not block another from reading quickly. And because `tee()` is part of the standard Web Streams API, this works identically in browsers, Node.js, and Bun.

### Pass-Through Streaming

When a downstream task is itself streamable and its input port declares the same stream mode as the upstream output port, something elegant happens: the stream can pass through without materialization. The `DependencyBasedScheduler` recognizes that a streaming upstream task can unblock a streamable downstream task early -- the downstream does not need to wait for full completion.

The graph runner tees each upstream stream: one copy goes to the downstream task's `inputStreams` map for its `executeStream()` to consume, and the other stays on the edge for materialization (in case something else needs the completed value). This is how streaming chains work -- an LLM task streaming tokens into a text display task, without ever buffering the entire response.

## Delta Accumulation: The Separation of Concerns

One of the most important architectural decisions in Workglow's streaming system is the strict separation between **providers** (which yield deltas) and the **TaskRunner** (which accumulates them).

### Providers Are Stateless

An AI provider's stream function yields incremental events and a final `finish` event with an empty data payload:

```ts
// From Anthropic_TextGeneration_Stream
for await (const event of stream) {
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    yield { type: "text-delta", port: "text", textDelta: event.delta.text };
  }
}
yield { type: "finish", data: {} as TextGenerationTaskOutput };
```

The provider never accumulates. It never tracks how many tokens it has emitted. It never builds up the complete string. It yields deltas and a termination signal, nothing more. This keeps providers simple, testable, and free of double-buffering bugs.

### The Runner Accumulates (When Needed)

The `TaskRunner.executeStreamingTask()` method decides whether to accumulate based on a `shouldAccumulate` flag, which the `TaskGraphRunner` computes from the graph topology:

- **Accumulate** when output caching is active (the cached value must be fully materialized), or when any downstream edge connects to a non-streaming input port.
- **Skip accumulation** when all downstream edges are also streaming with the same mode and no cache is needed.

When accumulating, the runner maintains a `Map<string, string>` for text deltas and a `Map<string, object>` for object deltas. On the `finish` event, instead of emitting the provider's empty finish payload, it emits an **enriched finish event** with the accumulated text merged in:

```ts
const merged: Record<string, unknown> = { ...(event.data || {}) };
for (const [port, text] of accumulated) {
  if (text.length > 0) merged[port] = text;
}
finalOutput = merged as unknown as Output;
this.task.emit("stream_chunk", { type: "finish", data: merged });
```

Because all downstream edges share the same enriched event through tee'd streams, no edge needs to re-accumulate independently. The `Dataflow.awaitStreamValue()` method can simply read the `finish` event's `data` field and materialize it as the edge's value.

## StreamEvent Types

All streaming communication flows through a single discriminated union type:

| Event Type      | Mode          | Payload                                    | Purpose                                              |
| --------------- | ------------- | ------------------------------------------ | ---------------------------------------------------- |
| `text-delta`    | append        | `{ port: string, textDelta: string }`      | One token or text fragment                           |
| `object-delta`  | object        | `{ port: string, objectDelta: object }`    | Progressively more complete partial object           |
| `snapshot`      | replace       | `{ data: Output }`                         | Full replacement of current state                    |
| `finish`        | all           | `{ data: Output }`                         | Stream complete; carries accumulated data if enabled |
| `error`         | all           | `{ error: Error }`                         | Stream encountered a fatal error                     |

The `port` field on delta events is critical. It allows the `StreamingAiTask` base class to route port-less events from providers (which do not know about Workglow's port system) to the correct output port, determined by the task's output schema `x-stream` annotations. A provider just yields `{ type: "text-delta", textDelta: "Hello" }`, and the `StreamingAiTask` wrapper adds `port: "text"` based on the schema.

## The x-stream Schema Annotation

The `x-stream` extension property is the single source of truth for streaming behavior. It lives on individual port properties within a task's JSON Schema:

```ts
export const TextGenerationOutputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      "x-stream": "append",   // <-- This is what makes it stream
    },
  },
  required: ["text"],
} as const satisfies DataPortSchema;
```

The helper functions in `StreamTypes.ts` inspect these annotations:

- `getPortStreamMode(schema, portId)` -- returns the stream mode for a single port
- `getStreamingPorts(schema)` -- returns all ports with streaming annotations
- `getOutputStreamMode(schema)` -- returns the dominant mode (or `"mixed"`)
- `isTaskStreamable(task)` -- checks both schema annotations AND that `executeStream()` is implemented
- `edgeNeedsAccumulation(sourceSchema, sourcePort, targetSchema, targetPort)` -- determines if an edge needs to accumulate (source streams but target does not accept the same mode)
- `getAppendPortId(schema)` / `getObjectPortId(schema)` -- find the first port with a specific mode

This schema-driven approach means that streaming behavior is declared, not imperatively coded. A task author annotates their output schema and implements `executeStream()`. The framework handles everything else: creating ReadableStreams, tee-ing for fan-out, accumulating deltas, enriching finish events, and materializing values on edges. You declare "this port streams in append mode" and the graph takes care of plumbing.

## Putting It All Together: LLM Token Streaming Through the Graph

Let us trace the complete journey of a single LLM token from API response to UI update.

**1. The provider yields a delta.** The Anthropic SDK fires a `content_block_delta` event. The provider stream function translates it:

```ts
yield { type: "text-delta", port: "text", textDelta: "Hello" };
```

**2. The `StreamingAiTask` annotates the port.** If the provider omitted the `port` field, the `StreamingAiTask.executeStream()` wrapper adds it based on the output schema's `x-stream: "append"` annotation.

**3. The `TaskRunner` processes the event.** `executeStreamingTask()` receives the event from the async iterable. If accumulating, it appends `"Hello"` to the accumulated string for the `"text"` port. It emits `stream_chunk` on the task, and updates progress with an exponential curve (`1 - e^(-0.05 * chunkCount)`) that asymptotically approaches 99%.

**4. The `TaskGraphRunner` propagates to edges.** The `onStreamChunk` listener forwards the event to the graph level (`task_stream_chunk`). Meanwhile, the `ReadableStream` created by `pushStreamToEdges()` enqueues the event. If there are three downstream consumers, `tee()` has split the stream into three independent copies.

**5. Downstream tasks react.** A streamable downstream task (like a UI display component) receives the event through its `inputStreams` and can render the token immediately. A non-streaming downstream task's edge calls `awaitStreamValue()`, which reads events until `finish` and materializes the accumulated value.

**6. The stream finishes.** The provider yields `{ type: "finish", data: {} }`. The runner enriches it: `{ type: "finish", data: { text: "Hello, world! How can I help you?" } }`. This enriched event flows through the tee'd streams to all edges. The `Dataflow.awaitStreamValue()` method picks up the finish event's `data` and sets it as the edge's materialized value. Downstream non-streaming tasks can now read their input through the normal `getPortData()` path.

**7. The scheduler unblocks.** `onTaskStreaming()` is called when the first chunk arrives, allowing the `DependencyBasedScheduler` to release downstream streamable tasks early. Non-streamable tasks wait for `COMPLETED`. The graph achieves maximum concurrency without sacrificing correctness.

---

The result is a system where streaming is not bolted on as an afterthought but is woven into the fundamental data model. Edges know whether they carry streams. Schemas declare streaming behavior. The scheduler understands that streaming tasks can unblock dependents early. And the clean separation between stateless providers and an accumulating runner means you can add a new AI provider without thinking about buffering, tee-ing, or materialization.

That is what it takes to make real-time AI pipelines a first-class concept rather than a leaky abstraction.
