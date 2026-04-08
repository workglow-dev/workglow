<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# The Worker System: Running Heavy AI Work Without Freezing Your App

If you have ever watched a browser tab lock up while a large language model churns through a prompt, you know the feeling. The cursor stops blinking, scroll becomes a suggestion, and the entire interface feels like it is underwater. The root cause is almost always the same: expensive computation running on the same thread that handles user interaction.

Workglow's worker system exists to make that problem disappear -- not by asking you to learn a new concurrency model, but by hiding most of the complexity behind a small, symmetric API that works identically whether you are targeting a browser tab, a Node.js server, or a Bun script.

This post walks through every layer of that system, from the high-level `WorkerManager` API all the way down to the structured cloning decisions that keep your data safe.

---

## Why Workers Matter for AI Pipelines

AI workloads are inherently bursty. An embedding model can block the event loop for hundreds of milliseconds. A text generation call to a cloud API still involves serialization, network I/O callbacks, and response parsing that adds up fast when you are processing dozens of documents in a pipeline.

In a traditional single-threaded JavaScript application, all of that contention translates directly into UI jank (in the browser) or degraded request throughput (on the server). Workers solve this by giving you genuinely separate execution contexts -- distinct threads with their own event loops, their own heaps, and their own module scopes.

But raw workers are famously unpleasant to use. You are left hand-rolling `postMessage` protocols, tracking request-response correlation, managing lifecycle, and duplicating all of it for every runtime you want to support. Workglow absorbs that pain.

---

## WorkerManager: The Main-Thread Orchestrator

The `WorkerManager` class (living in `@workglow/util`) is the single point of contact for all worker interaction on the main thread. It is registered as a singleton via Workglow's dependency injection system under the `WORKER_MANAGER` service token, so any part of the application can resolve it without passing references around.

At its core, WorkerManager maintains five internal maps:

| Map | Purpose |
|-----|---------|
| `workers` | Active `Worker` instances, keyed by name |
| `readyWorkers` | A `Promise<void>` per worker that resolves when the worker signals it is ready |
| `workerFunctions` | Set of regular function names the worker advertised |
| `workerStreamFunctions` | Set of streaming (async generator) function names |
| `workerReactiveFunctions` | Set of reactive (soft-fail preview) function names |

Two additional maps support lazy initialization:

| Map | Purpose |
|-----|---------|
| `lazyFactories` | Deferred `() => Worker` factories, not yet constructed |
| `lazyInitPromises` | Single-flight init promises to prevent duplicate construction |

When you call `workerManager.registerWorker("ANTHROPIC", factory)`, nothing heavy happens. The factory is stored. The actual `Worker` is not constructed until the first `callWorkerFunction`, `callWorkerStreamFunction`, or `callWorkerReactiveFunction` targets that name. This is critical for applications that register many providers at startup but may only use one or two during a given session -- you do not pay for workers you never touch.

---

## Three Function Types, Three Execution Models

Not all worker calls are created equal. Workglow distinguishes three kinds of registered functions, each with a different protocol and different guarantees.

### Regular Functions

The bread and butter. A regular function takes an input and a model configuration, does some work, and returns a result. On the worker side, it also receives a `postProgress` callback and an `AbortSignal`, so long-running operations can report incremental progress and respond to cancellation.

```typescript
// Worker side registration
workerServer.registerFunction("TextEmbeddingTask", async (input, model, postProgress, signal) => {
  postProgress(0.1, "Loading model...");
  // ... do work, checking signal.aborted periodically ...
  postProgress(1.0, "Done");
  return { vectors: result };
});
```

On the main thread, the call returns a promise that resolves with the result or rejects with a reconstructed `Error` (name and message preserved across the boundary).

### Stream Functions

Streaming is essential for text generation, where you want tokens to appear in the UI as they arrive rather than waiting for the entire response. Workglow's stream functions are async generators on the worker side. The `WorkerServerBase` iterates the generator and sends each yielded value as a `stream_chunk` message. On the main-thread side, `callWorkerStreamFunction` returns an `AsyncGenerator` that yields those chunks.

The bridge between the worker's push-based `postMessage` and the consumer's pull-based `for await...of` is a push-queue pattern:

```typescript
type QueueItem =
  | { kind: "event"; data: T }
  | { kind: "done" }
  | { kind: "error"; error: Error };
```

Worker messages push items into the queue. If the async generator is already waiting (suspended at `await`), the queue immediately notifies it. If the consumer is slower than the producer, items buffer naturally. If the consumer breaks out of the loop early (the user navigates away, perhaps), the manager sends an abort message to the worker so the generator stops producing tokens it nobody will read.

A nice fallback exists here too: if a stream call targets a function name that only has a regular (non-streaming) registration, the worker runs the regular function and wraps the result as a single `finish` stream event. Providers that have not implemented streaming yet still work seamlessly when a streaming caller requests them.

### Reactive Functions

Reactive functions serve a very different purpose. They power Workglow's `executeReactive()` path -- lightweight, sub-millisecond previews that run while a task graph is being edited, before any full execution. A token counter, for instance, can reactively preview an approximate count as the user types.

The key design difference: reactive calls are **soft-fail**. If the worker does not have a reactive function registered for the requested name, the call returns `undefined` instead of throwing. Errors are also swallowed and returned as `undefined`. This makes reactive calls safe to fire speculatively -- the UI code does not need to guard against missing implementations.

```typescript
const preview = await workerManager.callWorkerReactiveFunction("ANTHROPIC", "CountTokensTask", [
  input, currentOutput, model,
]);
// preview is either a result object or undefined -- never throws
```

---

## The Message Protocol

All communication between the main thread and a worker flows through `postMessage`, structured as simple objects with a standard shape:

**Main thread to worker:**

```
{ id: <UUID>, type: "call", functionName: string, args: any[], stream?: boolean, reactive?: boolean }
{ id: <UUID>, type: "abort" }
```

**Worker to main thread:**

```
{ type: "ready", functions: string[], streamFunctions: string[], reactiveFunctions: string[] }
{ id: <UUID>, type: "complete", data: any }
{ id: <UUID>, type: "error", data: { message: string, name: string } }
{ id: <UUID>, type: "progress", data: { progress: number, message?: string, details?: any } }
{ id: <UUID>, type: "stream_chunk", data: any }
```

Every call gets a `crypto.randomUUID()` identifier. The worker can process multiple concurrent requests (from different callers on the main thread), and each response routes back to the correct promise or generator by matching the `id` field.

The ready handshake deserves attention. When a worker boots, the `WorkerServerBase` calls `sendReady()` after all functions have been registered. This message includes the complete function manifest -- three arrays listing every name in each category. The `WorkerManager` stores these sets and uses them to short-circuit invalid calls without a round trip. If you call `callWorkerFunction("ANTHROPIC", "NonExistentTask", ...)`, you get an immediate local error, not a round trip to the worker and back.

A 10-second timeout guards against workers that fail to boot. If the ready message never arrives (bad import path, syntax error in the worker script, missing dependency), the promise rejects with a clear diagnostic rather than hanging forever.

---

## Worker Isolation: A Separate Universe

This is the part that trips people up the most, so it is worth stating clearly: **a worker has its own `globalServiceRegistry`**. It is a completely separate dependency injection container. Services registered on the main thread -- credential stores, knowledge base registries, storage backends -- do not exist in the worker.

This is by design, not an accident. The isolation model forces a clean separation:

1. **Main thread** resolves credentials, model configurations, and any other ambient state.
2. That resolved data is serialized into the function arguments.
3. **Worker** receives plain data and uses it directly.

Look at how the Anthropic provider handles this. On the main thread, the `AiTask.getJobInput()` method resolves the model configuration (including the credential key for the API) into a serializable `AiJobInput` object. That object is what gets sent to the worker. The worker-side `Anthropic_Client.getClient()` reads the API key from the `provider_config` field of the model -- it never reaches into a credential store.

This pattern has practical benefits beyond correctness. Workers can be terminated and recreated without losing global state. They can be pooled across providers. And they never become a vector for accidental credential leakage through shared mutable state.

---

## Cross-Runtime Support: One API, Three Runtimes

Workglow runs in browsers, Node.js, and Bun. Each runtime has a different worker primitive:

| Runtime | Primitive | Module |
|---------|-----------|--------|
| Browser | `globalThis.Worker` (Web Workers) | `Worker.browser.ts` |
| Node.js | `worker_threads.Worker` | `Worker.node.ts` |
| Bun | `globalThis.Worker` (Bun's Web Worker compat) | `Worker.bun.ts` |

The platform-specific files are small -- each one is under 50 lines. They export a normalized `Worker` class and a `WorkerServer` class that extends `WorkerServerBase`.

The Node.js adapter is the most interesting because `worker_threads` has a different event API than Web Workers. The `WorkerPolyfill` class wraps Node's `Worker` with `addEventListener`/`removeEventListener` methods that delegate to the EventEmitter-style `.on()`/`.off()`, making it compatible with the `WorkerManager`'s Web Worker-style event handling. It also handles `pathToFileURL` conversion so you can pass file paths instead of URLs.

The browser and Bun adapters are nearly identical. Both use `self.addEventListener("message", ...)` on the worker side. The `WorkerServerBase` does not care which runtime it is running in -- it just calls `postMessage`, which exists in all three environments.

Conditional exports in each package's `package.json` ensure the right file is loaded automatically:

```json
{
  "browser": "./dist/browser.js",
  "bun": "./dist/bun.js",
  "node": "./dist/node.js"
}
```

You write your provider code once. The bundler picks the right worker primitive.

---

## Structured Cloning: The Intentional Copy

There is a comment in `WorkerManager.callWorkerFunction` that reveals a deliberate design decision:

> We intentionally do NOT transfer TypedArrays from the main thread to the worker. Transferring detaches the buffers on the main thread, which breaks downstream tasks that still need those TypedArrays.

This is about the difference between *transferring* and *cloning*. When you transfer an `ArrayBuffer` to a worker, it becomes a zero-length detached buffer on the sending side -- the memory moves, it does not copy. That is great for performance but catastrophic for a pipeline where the same embedding vector might flow to multiple downstream tasks.

Workglow's rule is asymmetric:

- **Main thread to worker**: always clone. The main thread keeps its references intact, so the task graph can continue routing data to other tasks.
- **Worker to main thread**: transfer when possible. The `WorkerServerBase.postResult` method calls `extractTransferables()`, which walks the result object looking for `ArrayBuffer`s, `TypedArray`s, `OffscreenCanvas`es, `ImageBitmap`s, `VideoFrame`s, and `MessagePort`s. These are listed as transferables in the `postMessage` call, achieving zero-copy returns.

The `extractTransferables` function is thorough -- it handles all standard typed array types, recursively searches nested objects and arrays, and uses a `WeakSet` to avoid infinite loops on circular references. It also deduplicates the transferable list, since the same `ArrayBuffer` might back multiple typed array views.

This asymmetry means you pay a cloning cost on the way in but get zero-copy on the way out. For AI workloads, where the output (embeddings, generated text) is typically what you care about most, this is the right tradeoff.

---

## Lazy + Single-Flight: No Wasted Work

The lazy initialization pattern in `WorkerManager` solves two problems at once.

**Problem 1: Startup cost.** Constructing a worker means loading and parsing a JavaScript module in a new thread. For providers that bundle heavy ML libraries (like Hugging Face Transformers.js), this can take seconds. You do not want to pay that cost at application startup for every registered provider.

**Problem 2: Duplicate initialization.** If two task graph branches simultaneously request the same provider, you do not want to spawn two workers. The single-flight pattern prevents this:

```typescript
private async ensureWorkerReady(name: string): Promise<void> {
  // Already constructed? Just wait for ready.
  if (this.workers.has(name)) {
    await this.readyWorkers.get(name)!;
    return;
  }
  // Lazy factory exists? Check for in-flight init.
  let init = this.lazyInitPromises.get(name);
  if (!init) {
    // First caller: construct the worker and store the promise.
    init = (async () => {
      const f = this.lazyFactories.get(name)!;
      this.lazyFactories.delete(name);
      const worker = f();
      this.attachWorkerInstance(name, worker);
    })();
    this.lazyInitPromises.set(name, init);
  }
  // All callers (first and concurrent) await the same promise.
  await init;
  await this.readyWorkers.get(name)!;
  this.lazyInitPromises.delete(name);
}
```

The first caller creates the init promise and stores it. Any concurrent caller finds the existing promise and awaits it. Once the worker is ready, the promise is cleaned up. This is the classic single-flight / `singleflight.Do` pattern, adapted for async/await.

---

## Putting It All Together: The Anthropic Example

To see how all these pieces compose, follow the Anthropic provider through its lifecycle:

**1. Main-thread registration (no heavy imports):**

```typescript
await new AnthropicQueuedProvider().register({
  worker: () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
});
```

The provider has no `tasks` argument, so it registers in worker-backed mode. The `WorkerManager` stores the factory. No worker is created yet.

**2. First AI task executes:**

The task graph runs a `TextGenerationTask`. The `AiProviderRegistry` resolves it to the Anthropic worker proxy. The proxy calls `workerManager.callWorkerStreamFunction("ANTHROPIC", "TextGenerationTask", ...)`. This triggers `ensureWorkerReady`, which invokes the factory, constructs the worker, and waits for the ready handshake.

**3. Worker boots:**

Inside the worker script, `registerAnthropicWorker()` runs. It constructs an `AnthropicProvider` with all three task maps (`ANTHROPIC_TASKS`, `ANTHROPIC_STREAM_TASKS`, `ANTHROPIC_REACTIVE_TASKS`) and calls `registerOnWorkerServer(workerServer)`. Each function is registered under its task type name. Finally, `workerServer.sendReady()` sends the manifest back.

**4. Streaming begins:**

The `WorkerManager` sends a `{ type: "call", stream: true }` message. The `WorkerServerBase` finds the stream function, iterates it, and sends `stream_chunk` messages. The main-thread async generator yields each chunk to the `StreamingAiTask`, which accumulates deltas and updates the UI.

**5. User cancels:**

The `AbortSignal` fires. The `WorkerManager` sends `{ type: "abort" }`. The `WorkerServerBase` aborts the `AbortController` associated with that request ID. The async generator on the worker side sees the signal and stops generating. The main-thread generator's `finally` block cleans up event listeners.

Every step in this flow was designed to be invisible to the provider implementer. You write a function that takes input and yields events. The worker system handles the rest.

---

## Key Takeaways

The worker system is one of those infrastructure layers that succeeds by being boring. It does not introduce novel concurrency primitives or clever lock-free data structures. Instead, it takes the well-understood `postMessage` protocol and wraps it in just enough abstraction to make three things true:

1. **Provider authors never think about threads.** They write functions. The system moves those functions to workers.
2. **Application authors never think about initialization.** Workers appear when needed and share initialization across concurrent callers.
3. **Data flows safely.** Main-thread references are preserved by cloning on send; worker results are transferred zero-copy on return.

The result is an AI pipeline framework where you can run heavy embedding models, stream token-by-token text generation, and preview reactive token counts -- all without a single frame drop.
