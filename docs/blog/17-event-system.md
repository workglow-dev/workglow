<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# The Workglow Event System: Type-Safe, Cross-Runtime, Battle-Tested

Every sufficiently complex application eventually needs an event system. Node.js gives you `EventEmitter`. The browser gives you `EventTarget`. Both are dynamically typed, neither works seamlessly across runtimes, and both leave you guessing about what arguments a listener actually receives. Workglow needed something better.

This post walks through Workglow's custom `EventEmitter` -- a compact, generic, type-safe event system that powers everything from storage notifications to task lifecycle management to real-time UI updates. It runs identically in Node.js, Bun, and the browser. And it fits in under 200 lines of TypeScript.

## Why Build a Custom EventEmitter?

Three reasons drove the decision.

**Type safety.** Node's `EventEmitter` treats event names as strings and listener arguments as `any[]`. You can emit `"complet"` (typo) with the wrong arguments and nothing complains until runtime. In a pipeline engine where tasks flow through dozens of lifecycle states and storage operations fire events on every mutation, that kind of looseness is a bug factory.

**Cross-runtime compatibility.** Workglow runs on Node.js, Bun, and in the browser. Node's `EventEmitter` lives in the `events` module. The browser has `EventTarget` with a completely different API. Rather than shimming one to look like the other, Workglow uses a zero-dependency implementation that works everywhere.

**Specialized patterns.** The codebase needed `waitOn()` -- a promise-based API for awaiting a single event occurrence. It needed `subscribe()` -- a pattern that returns a cleanup function, perfect for React's `useEffect`. And it needed error batching during emit, so that one misbehaving listener doesn't prevent others from running. None of these come for free with the platform APIs.

## Type-Safe Generics: The Foundation

The core insight is that an event emitter should be *generic over its event listener map*. You define the shape of your events as a TypeScript record -- event names as keys, listener signatures as values -- and the compiler enforces correctness everywhere.

```typescript
export class EventEmitter<
  EventListenerTypes extends Record<string, (...args: any) => any>
> {
  private listeners: {
    [Event in keyof EventListenerTypes]?: EventListeners<EventListenerTypes, Event>;
  } = {};
  // ...
}
```

Every consumer defines its own event map. Here is how key-value storage declares its events:

```typescript
export type KvEventListeners<Key, Value, Combined> = {
  put: (key: Key, value: Value) => void;
  get: (key: Key, value: Value | undefined) => void;
  getAll: (results: Combined[] | undefined) => void;
  delete: (key: unknown) => void;
  deleteall: () => void;
};
```

And here is how tasks declare their lifecycle events:

```typescript
export type TaskEventListeners = {
  start: () => void;
  complete: () => void;
  abort: (error: TaskAbortedError) => void;
  error: (error: TaskError) => void;
  progress: (progress: number, message?: string, ...args: any[]) => void;
  status: (status: TaskStatus) => void;
  stream_start: () => void;
  stream_chunk: (event: StreamEvent) => void;
  stream_end: (output: Record<string, unknown>) => void;
  schemaChange: (inputSchema?: DataPortSchema, outputSchema?: DataPortSchema) => void;
  // ... and more
};
```

When you instantiate the emitter, the compiler knows exactly which events exist and what arguments each listener receives:

```typescript
protected events = new EventEmitter<KvEventListeners<Key, Value, Combined>>();
```

Try to call `this.events.emit("put", 42)` when `Key` is `string`? Compile error. Try to listen for `"putt"`? Compile error. Try to pass a listener with the wrong signature? Compile error. The event map *is* the documentation, and the compiler *is* the enforcement.

A helper type, `EventParameters`, extracts the parameter tuple from any event in the map. This powers the `emit` signature, the `waitOn` return type, and the forwarding wrappers that every storage and task class exposes:

```typescript
export type EventParameters<Events, EventType extends keyof Events> = {
  [Event in EventType]: EventListener<Events, EventType> extends (...args: infer P) => any
    ? P
    : never;
}[EventType];
```

## The Core API

The API surface is intentionally small: `on`, `off`, `once`, `emit`, `subscribe`, `waitOn`, and `removeAllListeners`. Each method is generic over the event name, so the compiler constrains both the event string and the listener/argument types at every call site.

### on / off / once

Standard fare, but fully typed. `on` registers a persistent listener. `off` removes it by reference equality. `once` registers a listener that auto-removes after its first invocation.

```typescript
on<Event extends keyof EventListenerTypes>(
  event: Event,
  listener: EventListener<EventListenerTypes, Event>
): this { /* ... */ }
```

All three return `this` for chaining, following a familiar fluent pattern:

```typescript
emitter
  .on("start", handleStart)
  .on("complete", handleComplete)
  .once("error", handleFirstError);
```

### emit: Snapshot, Run All, Collect Errors

The `emit` method is where the interesting engineering lives. It does three things that the naive implementation does not.

**First, it snapshots the listener array.** Before iterating, it copies the listener list with `[...listeners]`. This prevents a class of bugs where a listener adds or removes other listeners during the same emit cycle. Without the snapshot, you could skip listeners, double-fire listeners, or corrupt the iteration entirely. The snapshot makes concurrent modification safe:

```typescript
public emit<Event extends keyof EventListenerTypes>(
  event: Event,
  ...args: EventParameters<EventListenerTypes, Event>
) {
  const listeners = this.listeners[event];
  if (listeners) {
    // Snapshot the listener array to avoid issues with concurrent modification
    const snapshot = [...listeners];
    const errors: unknown[] = [];
    for (const { listener } of snapshot) {
      try {
        listener(...args);
      } catch (e) {
        errors.push(e);
      }
    }
    // Remove once listeners we just called
    this.listeners[event] = listeners.filter((l) => !l.once);
    // Re-throw the first error after all listeners have been called
    if (errors.length > 0) {
      throw errors[0];
    }
  }
}
```

**Second, it runs every listener even if one throws.** Each listener invocation is wrapped in a `try/catch`, and errors are collected into an array. This means that if you have five listeners on `"complete"` and the second one throws, listeners three through five still run. In a pipeline engine, this is critical -- you do not want a buggy progress reporter to prevent the task status from updating.

**Third, it re-throws the first collected error after all listeners have run.** The caller still sees the failure; it just does not short-circuit the other listeners. This is a deliberate trade-off: you get the reliability of running all handlers *and* the visibility of propagating the error.

The cleanup of `once` listeners happens after iteration, on the *original* array (not the snapshot). This ensures that the removal is clean and does not interfere with the snapshot-based iteration.

## waitOn: Promise-Based Event Waiting

Sometimes you need to *await* an event rather than register a callback. The `waitOn` method bridges the event and promise worlds:

```typescript
waitOn<Event extends keyof EventListenerTypes>(
  event: Event
): Promise<EmittedReturnType<EventListenerTypes, Event>> {
  return new Promise((resolve) => {
    const listener = ((...args: any[]) => {
      resolve(args as any);
    }) as EventListener<EventListenerTypes, Event>;
    this.once(event, listener);
  });
}
```

It registers a `once` listener that resolves a promise with the event's arguments as an array. This is invaluable in tests and in async coordination between tasks:

```typescript
// In a test: run a task and wait for completion
const runPromise = task.run();
const completePromise = task.waitOn("complete");
await Promise.all([runPromise, completePromise]);
expect(task.status).toBe(TaskStatus.COMPLETED);

// Wait for a specific progress event
const emittedPromise = task.waitOn("progress");
task.emit("progress", 0.42);
const result = await emittedPromise;
// result is [0.42]
```

The return type is `EmittedReturnType`, which extracts the parameter types from the event listener signature. For events with no arguments (like `"start"`), the promise resolves to an empty array. For events with arguments (like `"progress"`), you get a tuple of those arguments. The types flow through cleanly.

The Workflow class uses `waitOn` to coordinate graph-level operations:

```typescript
const resetPromise = workflow.waitOn("reset");
```

Storage classes expose `waitOn` for the same reason -- sometimes you need to know when a specific `put` or `delete` operation has been observed by the event system, without coupling to the storage implementation.

## The subscribe() Pattern

This is arguably the most impactful API in terms of day-to-day usage. `subscribe` is simply `on` that returns a cleanup function:

```typescript
public subscribe<Event extends keyof EventListenerTypes>(
  event: Event,
  listener: EventListener<EventListenerTypes, Event>
): () => void {
  this.on(event, listener);
  return () => this.off(event, listener);
}
```

The returned function captures the exact listener reference, so you never have to stash a reference to your callback just to clean up later. This pattern maps directly to React's `useEffect` cleanup idiom. Here is real code from Workglow's web UI, where a `TaskNode` component subscribes to multiple task events:

```typescript
useEffect(() => {
  const task = data.task;
  const unsubscribes: (() => void)[] = [];

  unsubscribes.push(
    task.subscribe("status", () => {
      setStatus(task.status);
    })
  );

  unsubscribes.push(
    task.subscribe("progress", () => {
      setProgress(calculateConsolidatedProgress(task));
    })
  );

  unsubscribes.push(
    task.subscribe("stream_start", () => {
      setIsStreaming(true);
      setStreamingText("");
    })
  );

  unsubscribes.push(
    task.subscribe("stream_chunk", (event: StreamEvent) => {
      if (event.type === "text-delta") {
        streamingTextRef.current += event.textDelta;
        setStreamingText(streamingTextRef.current);
      }
    })
  );

  return () => {
    unsubscribes.forEach((unsubscribe) => unsubscribe());
  };
}, [data.task]);
```

Collect the cleanup functions in an array, return a single function that calls them all. No stale listener leaks. No manual bookkeeping. Every subscription is guaranteed to be cleaned up when the component unmounts or the dependency changes.

## How Events Flow Through the System

The `EventEmitter` is a building block. It appears at every layer of the Workglow architecture, each layer defining its own typed event map.

### Storage Events

Both `KvStorage` and `BaseTabularStorage` wrap an internal `EventEmitter` and expose typed event methods. Key-value storage emits `put`, `get`, `delete`, and `deleteall`. Tabular storage emits `put`, `get`, `query`, `delete`, and `clearall`. Concrete implementations (InMemory, SQLite, IndexedDB, PostgreSQL) fire these events after their respective operations succeed, enabling reactive UI updates and cross-storage synchronization without polling.

### Graph Structure Events

The underlying `Graph` class (the data structure, not the pipeline) emits structural events: `node-added`, `node-removed`, `node-replaced`, `edge-added`, `edge-removed`, `edge-replaced`. The `TaskGraph` remaps these to domain-specific names -- `task_added`, `task_removed`, `dataflow_added`, and so on -- through a clean mapping table:

```typescript
export const EventDagToTaskGraphMapping = {
  "node-added": "task_added",
  "node-removed": "task_removed",
  "node-replaced": "task_replaced",
  "edge-added": "dataflow_added",
  "edge-removed": "dataflow_removed",
  "edge-replaced": "dataflow_replaced",
} as const;
```

When the graph's `on` method receives a domain event name like `"task_added"`, it translates it to the underlying DAG event and subscribes there. This layering means the graph data structure stays generic while the task graph speaks its own domain language.

### Task Lifecycle Events

Tasks emit a rich set of lifecycle events: `start`, `complete`, `abort`, `error`, `progress`, `status`, `regenerate`, `reset`, `schemaChange`, `entitlementChange`, and the streaming trio (`stream_start`, `stream_chunk`, `stream_end`). These events drive the `TaskRunner`, which orchestrates task state transitions, and they propagate upward to the `TaskGraph` via composite subscriptions.

### Composite Subscriptions

The `TaskGraph` builds higher-order subscription methods on top of the primitive `subscribe()`. For example, `subscribeToTaskStatus` subscribes to every task's `"status"` event *and* listens for `"task_added"` so it can subscribe to newly added tasks automatically:

```typescript
public subscribeToTaskStatus(
  callback: (taskId: TaskIdType, status: TaskStatus) => void
): () => void {
  const unsubscribes: (() => void)[] = [];

  for (const task of this.getTasks()) {
    unsubscribes.push(
      task.subscribe("status", (status) => callback(task.id, status))
    );
  }

  unsubscribes.push(
    this.subscribe("task_added", (taskId) => {
      const task = this.getTask(taskId);
      if (!task) return;
      unsubscribes.push(
        task.subscribe("status", (status) => callback(task.id, status))
      );
    })
  );

  return () => unsubscribes.forEach((unsub) => unsub());
}
```

The same pattern repeats for `subscribeToTaskProgress`, `subscribeToDataflowStatus`, `subscribeToTaskStreaming`, and `subscribeToTaskEntitlements`. Each returns a single cleanup function that tears down the entire subscription tree. The `subscribe()` return-value pattern makes this composition natural and leak-free.

### Model Repository Events

The AI model system follows the same pattern. `ModelRepository` emits `model_added`, `model_removed`, and `model_updated`, letting the rest of the system react to model registry changes without coupling to the repository internals.

## Design Decisions Worth Noting

**Synchronous emit.** The emitter calls listeners synchronously. This is intentional -- it matches the mental model of "emit fires listeners now" and avoids the complexity of async listener queuing. If a listener needs to do async work, it can fire-and-forget or use its own coordination mechanism.

**No wildcard events.** There is no `"*"` event or catch-all listener. Every event subscription is explicit. This keeps the type system simple and prevents the temptation to build fragile meta-listeners.

**No max listeners warning.** Node's `EventEmitter` warns when you exceed a listener count threshold (default 10). Workglow's implementation does not, because the composite subscription patterns in `TaskGraph` routinely attach listeners dynamically as tasks are added. A warning would be noise, not signal.

**No `emit` return value.** Node's `EventEmitter.emit` returns a boolean indicating whether any listeners were called. Workglow's returns `void`. The callers that care about listener presence use other mechanisms; the emit call is fire-and-observe.

## Wrapping Up

Workglow's `EventEmitter` is not a grand invention. It is a focused tool: 183 lines of TypeScript that solve the specific problems of type-safe, cross-runtime event handling with patterns that compose cleanly at every layer of the architecture. The listener snapshot prevents concurrent-modification bugs. Error batching prevents one bad listener from breaking the chain. `waitOn()` bridges events and promises. `subscribe()` returns cleanup functions that compose naturally in React effects, graph subscriptions, and test harnesses.

The best infrastructure is the kind you stop thinking about. You define your event map, the compiler checks your work, and the patterns compose all the way from a single storage `put` event to a graph-wide streaming subscription tree. That is what this event system delivers.
