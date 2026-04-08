<!--
@license
Copyright 2025 Steven Roussey <sroussey@gmail.com>
SPDX-License-Identifier: Apache-2.0
-->

# Eight Providers, One Interface: Inside Workglow's AI Provider System

*How Workglow talks to Anthropic, OpenAI, Gemini, Ollama, HuggingFace, llama.cpp, MediaPipe, and Chrome Built-in AI through a single abstraction -- without bundling 50MB of dependencies you never asked for.*

---

## The Real Cost of "Just Add Another Provider"

Every AI framework starts the same way. You wire up OpenAI. Then someone wants Anthropic. Then a user shows up running Ollama on their NAS. Then the browser team asks about on-device inference with WebGPU. And before you know it, your clean abstraction has devolved into a switch statement the size of a phone book, each branch importing a different SDK with its own authentication dance, streaming protocol, and error taxonomy.

Workglow supports eight AI providers. Some are cloud APIs that finish in milliseconds. Some download gigabyte-scale ONNX models and run them on your GPU. Some stream tokens. Some do not. Some need a job queue to serialize access to a single GPU. Some can happily fire off twenty concurrent requests.

The provider system has to handle all of this. And it has to do it without making your browser bundle weigh as much as a small operating system.

Here is how it works.

## The Provider Lineup

Before diving into architecture, here is what you get out of the box:

| Provider | Import Path | Local? | Browser? | Notable Capabilities |
|---|---|---|---|---|
| **Anthropic** | `./anthropic` | No | Yes | Claude models, streaming, tool calling |
| **OpenAI** | `./openai` | No | Yes | GPT models, embeddings, structured output |
| **Google Gemini** | `./gemini` | No | Yes | Gemini models, multimodal |
| **Ollama** | `./ollama` | Yes | Yes | Local LLM server, any GGUF model |
| **HuggingFace Transformers** | `./hf-transformers` | Yes | Yes | 22 task types, WebGPU/WASM, ONNX Runtime |
| **HuggingFace Inference** | `./hf-inference` | No | Yes | HF Inference API |
| **llama.cpp** | `./llamacpp` | Yes | No | Native GGUF inference via node-llama-cpp |
| **TensorFlow MediaPipe** | `./tf-mediapipe` | Yes | Yes | Vision, text, audio tasks via WASM |
| **Chrome Built-in AI** | `./chrome` | Yes | Yes | Browser-native summarization, translation, generation |

Nine sub-path exports (including Chrome Built-in AI). Eight distinct SDKs. One interface.

## Sub-Path Exports: The 50MB Problem

The `@huggingface/transformers` package alone is enormous. The `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`, `node-llama-cpp`, `ollama`, `@mediapipe/tasks-vision` -- each of these is a substantial dependency. If `@workglow/ai-provider` re-exported everything from a single barrel file, importing the package to use Anthropic would also pull in TensorFlow, ONNX Runtime, and every other SDK. Your bundle would be absurd.

The solution is sub-path exports. Each provider gets its own entry point in `package.json`:

```json
{
  "exports": {
    "./anthropic": {
      "types": "./dist/provider-anthropic/index.d.ts",
      "import": "./dist/provider-anthropic/index.js"
    },
    "./anthropic/runtime": {
      "types": "./dist/provider-anthropic/runtime.d.ts",
      "import": "./dist/provider-anthropic/runtime.js"
    },
    "./hf-transformers": { "..." },
    "./hf-transformers/runtime": { "..." },
    "./openai": { "..." }
  }
}
```

Every provider SDK is an optional peer dependency. If you only use Anthropic and OpenAI, those are the only SDKs that get resolved. HuggingFace Transformers never enters your dependency graph.

But notice there are *two* entry points per provider: the base path (`./anthropic`) and a `/runtime` sub-path. This is where things get interesting.

## The Two-File Split: Lightweight Shell vs. Heavy Runtime

Each provider directory has a deliberate split:

- **`index.ts`** -- exports the provider class, constants, model schema, and the worker-backed registration function. This file is lightweight. It imports nothing from the underlying SDK.
- **`runtime.ts`** -- exports the inline registration function, the worker registration function, and the actual `JobRunFns` that call the SDK. This file is heavy. It pulls in the full SDK.

Why? Because of the two ways a provider can register.

### Worker-backed registration (main thread stays lean)

```typescript
import { registerAnthropic } from "@workglow/ai-provider/anthropic";

await registerAnthropic({
  worker: () => new Worker(new URL("./anthropic-worker.ts", import.meta.url), { type: "module" }),
});
```

The main thread imports only from `./anthropic` -- constants, the provider class, and a registration function that creates worker proxies. The Anthropic SDK is never loaded on the main thread. The actual API calls happen inside the worker, which imports from `./anthropic/runtime`.

### Inline registration (everything in one thread)

```typescript
import { registerAnthropicInline } from "@workglow/ai-provider/anthropic/runtime";

await registerAnthropicInline();
```

Here the caller explicitly opts into the heavy import. The SDK loads in the current thread, and run functions execute directly. This is simpler to set up and perfectly fine for Node.js servers or scripts where bundle size is irrelevant.

The worker-side registration mirrors the inline pattern:

```typescript
// Inside anthropic-worker.ts
import { registerAnthropicWorker } from "@workglow/ai-provider/anthropic/runtime";
await registerAnthropicWorker();
```

Both inline and worker-server paths import the same `ANTHROPIC_TASKS` record from `Anthropic_JobRunFns.ts`. The difference is where those functions run, not what they are.

## The AiProvider Base Class: Constructor Injection as Architecture

The `AiProvider` abstract class is the heart of the system. Every provider extends it. But the design choice that makes the two-file split work is *constructor injection of task run functions*.

```typescript
export abstract class AiProvider<TModelConfig extends ModelConfig = ModelConfig> {
  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly isLocal: boolean;
  abstract readonly supportsBrowser: boolean;
  abstract readonly taskTypes: readonly string[];

  protected readonly tasks?: Record<string, AiProviderRunFn>;
  protected readonly streamTasks?: Record<string, AiProviderStreamFn>;
  protected readonly reactiveTasks?: Record<string, AiProviderReactiveRunFn>;

  constructor(
    tasks?: Record<string, AiProviderRunFn>,
    streamTasks?: Record<string, AiProviderStreamFn>,
    reactiveTasks?: Record<string, AiProviderReactiveRunFn>
  ) { ... }
}
```

The provider class itself declares what task types it supports (`taskTypes` -- a static list of strings) but does not import the implementations. The implementations are passed in at construction time. This means:

- **Worker-backed mode**: `new AnthropicQueuedProvider()` -- no tasks injected, no SDK imported. The provider class is just metadata.
- **Inline mode**: `new AnthropicQueuedProvider(ANTHROPIC_TASKS, ANTHROPIC_STREAM_TASKS, ANTHROPIC_REACTIVE_TASKS)` -- tasks injected, SDK loaded.
- **Worker server**: Same constructor as inline, but calls `registerOnWorkerServer()` instead of `register()`.

Three run function types cover three execution patterns:

1. **`tasks`** -- standard async run functions. `(input, model, updateProgress, signal) => Promise<Output>`. The workhorse.
2. **`streamTasks`** -- async generators that yield `StreamEvent` objects. For token-by-token output.
3. **`reactiveTasks`** -- lightweight preview functions for `executeReactive()`. Must complete in under a millisecond. Think: token counting that runs as you type.

## The Registration Lifecycle

When you call `provider.register()`, a carefully sequenced lifecycle unfolds:

```
onInitialize(context)          // Hook for provider setup (e.g., WASM backend config)
    |
    v
[Detect inline vs. worker mode based on constructor args]
    |
    +-- Inline: register each task's run/stream/reactive fn directly
    |
    +-- Worker: register worker proxy fns via WorkerManager
    |
    v
registerProvider(this)         // Add to AiProviderRegistry
    |
    v
afterRegister(options)         // Create job queues, register strategy resolvers
```

The `onInitialize` hook gives providers a chance to do pre-registration setup. HuggingFace Transformers uses it to configure the ONNX WASM backend (`env.backends.onnx.wasm.proxy = true`). Most providers leave it as a no-op.

The `afterRegister` hook is where `QueuedAiProvider` creates its job queue and registers a strategy resolver. If registration fails here, the base class cleans up the partially-registered provider so the registry never ends up in an inconsistent state.

The detection of inline vs. worker mode is implicit: if you passed tasks to the constructor, you are inline. If you did not, you must provide a `worker` option. There is no configuration flag. The constructor arguments *are* the configuration.

## QueuedAiProvider: When the GPU Is a Shared Resource

Cloud APIs like Anthropic and OpenAI handle concurrency on their end. You can fire off a hundred requests in parallel and they will happily process them (rate limits notwithstanding). These providers use `DirectExecutionStrategy` -- no queue, no serialization, just call the API.

Local providers are different. A GPU can run one model at a time. If you submit three embedding jobs and two text generation jobs simultaneously to a WebGPU-backed HuggingFace Transformers model, you do not get five parallel results. You get a crash. Or at best, thrashing that makes everything slower.

`QueuedAiProvider` extends `AiProvider` and creates a `QueuedExecutionStrategy` during `afterRegister`. This strategy wraps a full `JobQueueServer` with a `ConcurrencyLimiter`:

```typescript
export abstract class QueuedAiProvider extends AiProvider {
  protected override async afterRegister(options: AiProviderRegisterOptions): Promise<void> {
    this.queuedStrategy = new QueuedExecutionStrategy(
      `${this.name}_gpu`,
      resolveAiProviderGpuQueueConcurrency(options.queue?.concurrency),
      autoCreate
    );
    getAiProviderRegistry().registerStrategyResolver(this.name, (model) =>
      this.getStrategyForModel(model)
    );
  }
}
```

The queue is created lazily, backed by in-memory storage, with a default concurrency of 1 for GPU work. Jobs are submitted, serialized, executed one at a time, and their results are returned to the caller. The caller does not know or care that a queue was involved.

### HuggingFace Transformers: The Dual-Queue Pattern

The most sophisticated provider in the system is `HuggingFaceTransformersQueuedProvider`. It does not just have one queue -- it has two.

Why? Because ONNX Runtime can target either WebGPU or WASM. WebGPU jobs need strict serialization (one at a time on the GPU). WASM jobs run on the CPU and can safely run in parallel -- four at a time in production, one in test environments to avoid flaky contention on shared caches.

```typescript
export class HuggingFaceTransformersQueuedProvider extends QueuedAiProvider {
  private cpuStrategy: IAiExecutionStrategy | undefined;

  protected override async afterRegister(options: AiProviderRegisterOptions): Promise<void> {
    await super.afterRegister(options);  // Creates the GPU queue
    this.cpuStrategy = this.createQueuedStrategy(
      HF_TRANSFORMERS_ONNX_CPU,
      resolveHftCpuQueueConcurrency(options.queue?.concurrency, hftDefaultCpuQueueConcurrency),
      options
    );
  }

  protected override getStrategyForModel(model: ModelConfig): IAiExecutionStrategy {
    const device = model.provider_config?.device;
    if (device && GPU_DEVICES.has(device)) {
      return this.queuedStrategy!;  // GPU queue: concurrency 1
    }
    return this.cpuStrategy!;         // CPU queue: concurrency 4
  }
}
```

The `getStrategyForModel` override inspects the model's `device` field at execution time. A model configured for `"webgpu"` gets routed to the GPU queue. A model configured for `"wasm"` (or left unspecified) gets routed to the CPU queue. The routing is invisible to the task that submitted the job.

You can override the concurrency for either queue:

```typescript
await registerHuggingFaceTransformersInline({
  queue: { concurrency: { gpu: 1, cpu: 8 } },
});
```

## The Stateless Streaming Convention

Provider stream functions follow a strict contract: **yield deltas, never accumulate**.

```typescript
const Anthropic_TextGeneration_Stream: AiProviderStreamFn = async function* (
  input, model, signal
) {
  const stream = client.messages.stream({ ... }, { signal });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield { type: "text-delta", port: "text", textDelta: event.delta.text };
    }
  }
  yield { type: "finish", data: {} as TextGenerationTaskOutput };
};
```

Three rules:

1. **Yield incremental `text-delta` or `object-delta` events** as they arrive from the upstream API. Never buffer. Never concatenate.
2. **The final `finish` event carries `{} as Output`**, not the accumulated result. The consumer (`StreamingAiTask` / `TaskRunner`) is responsible for assembling deltas into the final output.
3. **No state between yields.** The provider function is a pure pipeline stage: data in, events out.

This separation keeps providers stateless and avoids double-buffering. The consumer accumulates because it needs to track the output anyway (for caching, reactive updates, and downstream dataflows). The provider does not because it should not.

When a queued provider receives a streaming request, the `QueuedExecutionStrategy` falls back gracefully: it runs the non-streaming `execute()` path to preserve GPU serialization, then yields a single `finish` event with the complete result. The caller gets the same event interface either way.

## Adding a New Provider: The Checklist

Want to add a new provider? Here is what the framework needs from you.

### 1. Define your model config schema

Extend `ModelConfig` with provider-specific fields:

```typescript
export interface MyProviderModelConfig extends ModelConfig {
  readonly provider: "MY_PROVIDER";
  readonly provider_config?: {
    readonly model_name?: string;
    readonly api_key?: string;
  };
}
```

### 2. Write your run functions

One function per task type you support. Each function is a standalone async function with the `AiProviderRunFn` signature:

```typescript
const MyProvider_TextGeneration: AiProviderRunFn<
  TextGenerationTaskInput,
  TextGenerationTaskOutput,
  MyProviderModelConfig
> = async (input, model, updateProgress, signal) => {
  updateProgress(0, "Starting generation");
  const result = await mySDK.generate(input.prompt, { signal });
  updateProgress(100, "Done");
  return { text: result };
};
```

For streaming, implement `AiProviderStreamFn`. For reactive previews, implement `AiProviderReactiveRunFn`. Export them all from a `JobRunFns.ts` file as three records:

```typescript
export const MY_TASKS: Record<string, AiProviderRunFn> = {
  TextGenerationTask: MyProvider_TextGeneration,
};
export const MY_STREAM_TASKS: Record<string, AiProviderStreamFn> = {
  TextGenerationTask: MyProvider_TextGeneration_Stream,
};
export const MY_REACTIVE_TASKS: Record<string, AiProviderReactiveRunFn> = {};
```

### 3. Create two provider classes

A lightweight one for workers (extends `AiProvider`):

```typescript
export class MyProvider extends AiProvider<MyProviderModelConfig> {
  readonly name = "MY_PROVIDER";
  readonly displayName = "My Provider";
  readonly isLocal = false;
  readonly supportsBrowser = true;
  readonly taskTypes = ["TextGenerationTask"] as const;
}
```

And a main-thread one. If your provider needs GPU queuing, extend `QueuedAiProvider`. If it is a cloud API, extend `AiProvider` directly (the registry will default to `DirectExecutionStrategy`).

### 4. Write the registration functions

Three functions, mirroring the Anthropic pattern:

```typescript
// registerMyProviderInline.ts -- pulls in SDK
export async function registerMyProviderInline(options?) {
  await new MyQueuedProvider(MY_TASKS, MY_STREAM_TASKS, MY_REACTIVE_TASKS)
    .register(options ?? {});
}

// registerMyProvider.ts -- worker-backed, no SDK
export async function registerMyProvider(options: { worker: Worker | (() => Worker) }) {
  await new MyQueuedProvider().register(options);
}

// registerMyProviderWorker.ts -- inside the worker
export async function registerMyProviderWorker() {
  const workerServer = globalServiceRegistry.get(WORKER_SERVER);
  new MyProvider(MY_TASKS, MY_STREAM_TASKS, MY_REACTIVE_TASKS)
    .registerOnWorkerServer(workerServer);
  workerServer.sendReady();
}
```

### 5. Set up sub-path exports

Add two entries to `package.json`:

```json
"./my-provider": {
  "types": "./dist/provider-my-provider/index.d.ts",
  "import": "./dist/provider-my-provider/index.js"
},
"./my-provider/runtime": {
  "types": "./dist/provider-my-provider/runtime.d.ts",
  "import": "./dist/provider-my-provider/runtime.js"
}
```

List your SDK as an optional peer dependency so consumers who never import your provider are never forced to install your SDK.

### 6. Register models

Use `ModelRepository` and `ModelRegistry` to declare what models your provider supports, their capabilities, and their default configurations. Tasks use this metadata to validate that a selected model actually supports the task being run.

That is it. The framework handles strategy resolution, queue creation, worker proxying, progress reporting, abort propagation, and cleanup. You write the functions that call your SDK, and the framework wires them into the task graph.

## The Design Philosophy

The AI provider system embodies a few principles worth calling out:

**Import cost is a feature, not a detail.** The entire two-file split, the constructor injection, the optional peer dependencies, the sub-path exports -- all of this exists because importing code you do not use is not free. In a browser, it is measured in seconds of load time. The architecture pays complexity at the framework level so that consumers pay nothing at the bundle level.

**The constructor is the configuration.** There are no mode flags, no `{ type: "worker" }` options, no runtime detection. If you pass tasks to the constructor, you are running inline. If you do not, you are running via a worker. The type system enforces this: `register()` will throw if you forget the worker option in worker-backed mode.

**Queuing is transparent.** A task does not know whether its provider uses direct execution or a job queue. The `AiProviderRegistry` resolves the right `IAiExecutionStrategy` for the model at execution time. A cloud API gets `DirectExecutionStrategy`. A WebGPU model gets `QueuedExecutionStrategy` with concurrency 1. A WASM model gets a different queue with concurrency 4. The task just calls `execute()` and gets its result.

**Providers are stateless pipelines.** Run functions take input and produce output. Stream functions yield events. Neither accumulates state. This makes them safe to run in workers, safe to retry, and simple to test in isolation.

Eight providers. One interface. Zero unnecessary bytes in your bundle. That is the goal, and the architecture delivers.
