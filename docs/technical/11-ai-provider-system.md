<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# AI Provider System

## Overview

The AI provider system is the bridge between abstract AI tasks and concrete model execution. A
**provider** represents a backend service or runtime -- OpenAI's API, Anthropic's API, a local
Ollama server, HuggingFace Transformers running in-browser via WebGPU, and so on. Each provider
registers **run functions** that know how to execute specific task types against that backend.

The system is designed around two registration modes:

1. **Inline** -- the provider imports its run functions directly and registers them on the main
   thread. Suitable for lightweight API providers where the "run function" is just an HTTP call.
2. **Worker** -- the provider registers proxy functions on the main thread that delegate to a Web
   Worker. The heavy ML libraries are loaded only inside the worker. This keeps the main thread
   responsive for GPU-intensive local inference.

```
Main Thread                              Worker Thread
┌──────────────────────┐                ┌──────────────────────┐
│  AiProvider.register │                │  AiProvider          │
│    (worker mode)     │                │  .registerOnWorker   │
│                      │     message    │  Server(server)      │
│  workerProxy(fn) ────┼───────────────>│                      │
│                      │     result     │  actual run fn       │
│  <───────────────────┼────────────────│  (heavy ML imports)  │
└──────────────────────┘                └──────────────────────┘
```

Source files:

| File | Purpose |
|------|---------|
| `packages/ai/src/provider/AiProvider.ts` | `AiProvider` abstract base class |
| `packages/ai/src/provider/QueuedAiProvider.ts` | `QueuedAiProvider` with job queue support |
| `packages/ai/src/provider/AiProviderRegistry.ts` | Singleton registry and function type definitions |
| `packages/ai/src/execution/IAiExecutionStrategy.ts` | Strategy interface |
| `packages/ai/src/execution/DirectExecutionStrategy.ts` | Non-queued strategy |
| `packages/ai/src/execution/QueuedExecutionStrategy.ts` | Queue-based strategy |

---

## AiProvider Base Class

`AiProvider` is the abstract base class that all providers extend. It handles the mechanics of
registering run functions with the `AiProviderRegistry` and setting up worker proxies.

### Abstract Properties

Every provider subclass must declare:

```typescript
abstract class AiProvider<TModelConfig extends ModelConfig = ModelConfig> {
  /** Unique identifier (e.g., "HF_TRANSFORMERS_ONNX", "OPENAI", "ANTHROPIC") */
  abstract readonly name: string;

  /** Human-readable label for UI display */
  abstract readonly displayName: string;

  /** Whether models run on the local machine */
  abstract readonly isLocal: boolean;

  /** Whether the provider works in browser environments */
  abstract readonly supportsBrowser: boolean;

  /** List of task type names this provider supports */
  abstract readonly taskTypes: readonly string[];
}
```

### Constructor

The constructor accepts three optional maps of run functions:

```typescript
constructor(
  tasks?: Record<string, AiProviderRunFn>,         // Standard execution
  streamTasks?: Record<string, AiProviderStreamFn>, // Streaming execution
  reactiveTasks?: Record<string, AiProviderReactiveRunFn> // Reactive previews
)
```

If `tasks` is provided, the provider operates in **inline mode**. If omitted, it operates in
**worker mode** and requires a `worker` option during registration.

### Run Function Types

```typescript
// Standard run function -- returns a Promise with the full output
type AiProviderRunFn<Input, Output, Model> = (
  input: Input,
  model: Model | undefined,
  update_progress: (progress: number, message?: string, details?: any) => void,
  signal: AbortSignal,
  outputSchema?: JsonSchema
) => Promise<Output>;

// Streaming run function -- yields incremental StreamEvents
type AiProviderStreamFn<Input, Output, Model> = (
  input: Input,
  model: Model | undefined,
  signal: AbortSignal,
  outputSchema?: JsonSchema
) => AsyncIterable<StreamEvent<Output>>;

// Reactive run function -- lightweight preview, no signal/progress
type AiProviderReactiveRunFn<Input, Output, Model> = (
  input: Input,
  output: Output,
  model: Model | undefined
) => Promise<Output | undefined>;
```

### Registration: register()

The `register()` method is the main entry point for adding a provider to the system:

```typescript
async register(options: AiProviderRegisterOptions = {}): Promise<void>
```

The method inspects whether `tasks` was provided via the constructor to determine inline vs worker
mode:

**Inline mode** (tasks provided):
1. Calls `onInitialize()` lifecycle hook.
2. Registers each task's run function directly with `AiProviderRegistry.registerRunFn()`.
3. Registers streaming functions if `streamTasks` was provided.
4. Registers reactive functions if `reactiveTasks` was provided.
5. Registers the provider instance on the registry.
6. Calls `afterRegister()` lifecycle hook.

**Worker mode** (no tasks, worker required):
1. Calls `onInitialize()` lifecycle hook.
2. Registers the worker with the `WorkerManager` from the DI system.
3. For each task type, registers worker proxy functions via
   `registerAsWorkerRunFn()`, `registerAsWorkerStreamFn()`, and
   `registerAsWorkerReactiveRunFn()`.
4. Registers the provider instance on the registry.
5. Calls `afterRegister()` lifecycle hook.

If `afterRegister()` throws (e.g., queue creation fails), the provider is cleaned up from the
registry to avoid an inconsistent state.

```typescript
// Worker mode example
await new MyProvider().register({
  worker: () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
  queue: { concurrency: 1 },
});

// Inline mode example
import { MY_TASKS, MY_STREAM_TASKS } from "./MyJobRunFns";
await new MyProvider(MY_TASKS, MY_STREAM_TASKS).register();
```

### Registration: registerOnWorkerServer()

Called inside a Web Worker to make the provider's functions available for remote invocation:

```typescript
registerOnWorkerServer(workerServer: WorkerServer): void
```

This method requires `tasks` to have been provided via the constructor. It registers each function
on the `WorkerServer`, which handles the message-passing protocol with the main thread.

```typescript
// Inside worker.ts
import { MY_TASKS, MY_STREAM_TASKS } from "./MyJobRunFns";
const server = new WorkerServer();
new MyProvider(MY_TASKS, MY_STREAM_TASKS).registerOnWorkerServer(server);
```

### Lifecycle Hooks

| Hook | When Called | Purpose |
|------|------------|---------|
| `onInitialize(context)` | Start of `register()` | Provider-specific setup (e.g., WASM backend config) |
| `afterRegister(options)` | End of `register()` | Post-registration setup (e.g., queue creation) |
| `dispose()` | Manual teardown | Resource cleanup (e.g., clearing pipeline caches) |

---

## QueuedAiProvider

`QueuedAiProvider` extends `AiProvider` for providers that need serialized GPU access. It
automatically creates a `QueuedExecutionStrategy` and registers a strategy resolver.

```typescript
abstract class QueuedAiProvider<TModelConfig extends ModelConfig = ModelConfig>
  extends AiProvider<TModelConfig>
```

### Queue Setup

The `afterRegister()` override creates a `QueuedExecutionStrategy` with a queue named
`{providerName}_gpu` and registers a strategy resolver on the `AiProviderRegistry`:

```typescript
protected override async afterRegister(options: AiProviderRegisterOptions): Promise<void> {
  this.queuedStrategy = new QueuedExecutionStrategy(
    `${this.name}_gpu`,
    resolveAiProviderGpuQueueConcurrency(options.queue?.concurrency),
    options.queue?.autoCreate !== false
  );
  getAiProviderRegistry().registerStrategyResolver(
    this.name,
    (model) => this.getStrategyForModel(model)
  );
}
```

### Concurrency Configuration

The `queue.concurrency` option controls how many jobs can run simultaneously:

```typescript
type AiProviderQueueConcurrency = number | Record<string, number>;
```

- **Numeric** -- sets the GPU queue limit directly (e.g., `1` for single-GPU serialization).
- **Record** -- supports multiple named queues. For example, HuggingFace Transformers ONNX uses
  `{ gpu: 1, cpu: 4 }` to run one WebGPU model at a time but allow four CPU/WASM models
  concurrently.

The `resolveAiProviderGpuQueueConcurrency()` helper resolves the primary GPU queue limit from
either form, defaulting to 1.

### Model-Aware Strategy Selection

Subclasses can override `getStrategyForModel()` to make the execution strategy depend on the
model's configuration:

```typescript
// Example: HFT provider routes WebGPU models through the queue,
// but WASM models can run directly
protected getStrategyForModel(model: ModelConfig): IAiExecutionStrategy {
  if (model.provider_config?.device === "webgpu") {
    return this.queuedStrategy!;
  }
  return new DirectExecutionStrategy();
}
```

---

## AiProviderRegistry

The `AiProviderRegistry` is a singleton that manages all provider registrations, run function
lookups, and execution strategy resolution.

### Internal State

```typescript
class AiProviderRegistry {
  runFnRegistry: Map<string, Map<string, AiProviderRunFn>>;       // taskType -> provider -> fn
  streamFnRegistry: Map<string, Map<string, AiProviderStreamFn>>;
  reactiveRunFnRegistry: Map<string, Map<string, AiProviderReactiveRunFn>>;
  private providers: Map<string, AiProvider>;
  private strategyResolvers: Map<string, AiStrategyResolver>;
  private defaultStrategy: IAiExecutionStrategy | undefined;
}
```

The function registries use a two-level `Map`: the outer key is the **task type** (e.g.,
`"TextGenerationTask"`), and the inner key is the **provider name** (e.g., `"OPENAI"`). This allows
efficient lookup: given a task type and provider, the correct function is found in O(1).

### Singleton Access

```typescript
let providerRegistry: AiProviderRegistry = new AiProviderRegistry();

function getAiProviderRegistry(): AiProviderRegistry;
function setAiProviderRegistry(pr: AiProviderRegistry): void;
```

`setAiProviderRegistry()` allows replacing the singleton, which is useful for testing or for
creating isolated environments.

### Function Registration

#### Direct Registration

```typescript
registry.registerRunFn("OPENAI", "TextGenerationTask", openaiTextGenFn);
registry.registerStreamFn("OPENAI", "TextGenerationTask", openaiTextGenStreamFn);
registry.registerReactiveRunFn("OPENAI", "CountTokensTask", openaiCountTokensFn);
```

#### Worker Proxy Registration

For worker-backed providers, proxy functions are created automatically:

```typescript
registry.registerAsWorkerRunFn("HF_TRANSFORMERS_ONNX", "TextEmbeddingTask");
registry.registerAsWorkerStreamFn("HF_TRANSFORMERS_ONNX", "TextGenerationTask");
registry.registerAsWorkerReactiveRunFn("HF_TRANSFORMERS_ONNX", "CountTokensTask");
```

The proxy functions delegate to `WorkerManager.callWorkerFunction()`,
`callWorkerStreamFunction()`, and `callWorkerReactiveFunction()` respectively.

### Function Retrieval

```typescript
// Throws if no function is found (with helpful diagnostic message)
const runFn = registry.getDirectRunFn<Input, Output>("OPENAI", "TextGenerationTask");

// Returns undefined if not found
const streamFn = registry.getStreamFn<Input, Output>("OPENAI", "TextGenerationTask");
const reactiveFn = registry.getReactiveRunFn<Input, Output>("OPENAI", "CountTokensTask");
```

`getDirectRunFn()` throws with a diagnostic message that lists installed providers and which
providers support the requested task type, helping developers identify registration issues.

### Strategy Resolution

```typescript
// Register a strategy resolver for a provider
registry.registerStrategyResolver("HF_TRANSFORMERS_ONNX", (model) => {
  if (model.provider_config?.device === "webgpu") {
    return queuedStrategy;
  }
  return directStrategy;
});

// Resolve strategy for a model (falls back to DirectExecutionStrategy)
const strategy = registry.getStrategy(model);
```

### Provider Introspection

```typescript
// Get a specific provider instance
const provider = registry.getProvider("OPENAI");

// Get all registered providers
const providers: Map<string, AiProvider> = registry.getProviders();

// Get sorted list of installed provider IDs
const ids: string[] = registry.getInstalledProviderIds();
// ["ANTHROPIC", "HF_TRANSFORMERS_ONNX", "OPENAI", "OLLAMA"]

// Get providers that support a specific task type
const textGenProviders: string[] = registry.getProviderIdsForTask("TextGenerationTask");
// ["ANTHROPIC", "OPENAI", "OLLAMA"]
```

---

## Provider Lifecycle

The complete lifecycle of a provider from registration to execution:

```
1. Construction
   new MyProvider(tasks?, streamTasks?, reactiveTasks?)

2. Registration (main thread)
   await provider.register({ worker?, queue? })
     -> onInitialize(context)
     -> register run functions (inline or worker proxy)
     -> registerProvider(this) on AiProviderRegistry
     -> afterRegister(options) -- QueuedAiProvider creates queue here

3. Worker Setup (worker thread, if worker mode)
   new MyProvider(tasks, streamTasks).registerOnWorkerServer(server)

4. Execution (triggered by AiTask.execute())
   strategy = registry.getStrategy(model)
   output = strategy.execute(jobInput, context, runnerId)
     -> DirectExecutionStrategy: AiJob.execute() -> getDirectRunFn() -> fn()
     -> QueuedExecutionStrategy: submit to queue -> AiJob.execute() -> fn()

5. Disposal
   await provider.dispose()
```

---

## Streaming Convention

Provider stream functions (`AiProviderStreamFn`) follow a strict convention:

1. **Do not accumulate output.** Yield incremental `text-delta` or `object-delta` events only.
2. **Yield a `finish` event** at the end with `{} as Output`. The consumer (`StreamingAiTask` /
   `TaskRunner`) is responsible for accumulating deltas into the final output.
3. **No `update_progress` callback.** For streaming providers, the stream itself is the progress
   signal.
4. **Include `AbortSignal` support.** The `signal` parameter must be checked or passed through to
   underlying API calls.

This design keeps providers stateless and avoids double-buffering.

```typescript
// Correct streaming implementation
async function* myStreamFn(
  input: Input,
  model: ModelConfig,
  signal: AbortSignal,
  outputSchema?: JsonSchema
): AsyncIterable<StreamEvent<Output>> {
  const stream = await callModelApi(input, model, { signal });

  for await (const chunk of stream) {
    yield { type: "text-delta", delta: chunk.text };
  }

  yield { type: "finish", data: {} as Output };
}
```

---

## Sub-Path Exports

Unlike other packages that build per-runtime targets (`browser.ts`, `node.ts`, `bun.ts`), the
`@workglow/ai-provider` package builds per-provider sub-paths. Each provider is a separate import
with optional peer dependencies:

```typescript
import "@workglow/ai-provider/anthropic";   // Claude (requires @anthropic-ai/sdk)
import "@workglow/ai-provider/openai";       // OpenAI (requires openai)
import "@workglow/ai-provider/gemini";       // Google Gemini
import "@workglow/ai-provider/ollama";       // Ollama (browser + node)
import "@workglow/ai-provider/hf-transformers"; // HuggingFace Transformers.js
import "@workglow/ai-provider/hf-inference";    // HuggingFace Inference API
import "@workglow/ai-provider/llamacpp";     // node-llama-cpp
import "@workglow/ai-provider/tf-mediapipe"; // TensorFlow MediaPipe (browser)
```

Each sub-path exports a provider class and its associated task run functions. The heavy ML
libraries are peer dependencies so they are only installed when the specific provider is used.

---

## Available Providers

| Provider | Class | `name` | Local | Browser | Key Task Types |
|----------|-------|--------|-------|---------|----------------|
| Anthropic | `AnthropicProvider` | `"ANTHROPIC"` | No | No | Text generation, summarization, tool calling |
| OpenAI | `OpenAiProvider` | `"OPENAI"` | No | No | Text generation, embeddings, structured output |
| Google Gemini | `GeminiProvider` | `"GOOGLE_GEMINI"` | No | No | Text generation, embeddings |
| Ollama | `OllamaProvider` | `"OLLAMA"` | Yes | Yes | Text generation, embeddings |
| HF Transformers | `HftProvider` | `"HF_TRANSFORMERS_ONNX"` | Yes | Yes | Embeddings, classification, NER, segmentation |
| HF Inference | `HfInferenceProvider` | `"HF_INFERENCE"` | No | Yes | Text generation, embeddings |
| LlamaCpp | `LlamaCppProvider` | `"LOCAL_LLAMACPP"` | Yes | No | Text generation |
| MediaPipe | `MediaPipeProvider` | `"TF_MEDIAPIPE"` | Yes | Yes | Pose detection, face/hand landmarks |

---

## Adding a New Provider

To add a new provider to the Workglow framework:

### Step 1: Create the Provider Class

```typescript
import { AiProvider } from "@workglow/ai";
// Or QueuedAiProvider for GPU-bound providers:
// import { QueuedAiProvider } from "@workglow/ai";

export class MyCloudProvider extends AiProvider {
  readonly name = "MY_CLOUD";
  readonly displayName = "My Cloud AI";
  readonly isLocal = false;
  readonly supportsBrowser = true;
  readonly taskTypes = [
    "TextGenerationTask",
    "TextEmbeddingTask",
  ] as const;
}
```

### Step 2: Implement Run Functions

Create a separate file (e.g., `MyCloudJobRunFns.ts`) with the actual implementations:

```typescript
import type { AiProviderRunFn, AiProviderStreamFn } from "@workglow/ai";

const textGenerationRunFn: AiProviderRunFn = async (input, model, updateProgress, signal) => {
  const response = await fetch("https://api.mycloud.ai/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: input.prompt, model: model?.model_id }),
    signal,
  });
  return { text: await response.text() };
};

const textGenerationStreamFn: AiProviderStreamFn = async function* (input, model, signal) {
  const response = await fetch("https://api.mycloud.ai/stream", {
    method: "POST",
    body: JSON.stringify({ prompt: input.prompt, model: model?.model_id }),
    signal,
  });
  const reader = response.body!.getReader();
  // ... yield text-delta events ...
  yield { type: "finish", data: {} as any };
};

export const MY_CLOUD_TASKS = {
  TextGenerationTask: textGenerationRunFn,
  TextEmbeddingTask: textEmbeddingRunFn,
};

export const MY_CLOUD_STREAM_TASKS = {
  TextGenerationTask: textGenerationStreamFn,
};
```

### Step 3: Register the Provider

```typescript
import { MyCloudProvider } from "./MyCloudProvider";
import { MY_CLOUD_TASKS, MY_CLOUD_STREAM_TASKS } from "./MyCloudJobRunFns";

// Inline registration
await new MyCloudProvider(MY_CLOUD_TASKS, MY_CLOUD_STREAM_TASKS).register();
```

### Step 4: Register Models

```typescript
import { getGlobalModelRepository } from "@workglow/ai";

const repo = getGlobalModelRepository();
await repo.addModel({
  model_id: "my-cloud-gpt",
  title: "My Cloud GPT",
  description: "A cloud-hosted language model",
  provider: "MY_CLOUD",
  tasks: ["TextGenerationTask", "TextEmbeddingTask"],
  provider_config: {},
  metadata: {},
});
```

---

## API Reference

### AiProvider (abstract)

| Member | Type | Description |
|--------|------|-------------|
| `name` | `string` (abstract) | Unique provider identifier |
| `displayName` | `string` (abstract) | Human-readable label |
| `isLocal` | `boolean` (abstract) | Whether models run locally |
| `supportsBrowser` | `boolean` (abstract) | Whether usable in browsers |
| `taskTypes` | `readonly string[]` (abstract) | Supported task type names |
| `register(options?)` | `Promise<void>` | Register on the main thread |
| `registerOnWorkerServer(server)` | `void` | Register on a Web Worker |
| `dispose()` | `Promise<void>` | Cleanup resources |
| `getRunFn(taskType)` | `AiProviderRunFn \| undefined` | Get run function for task type |
| `getStreamFn(taskType)` | `AiProviderStreamFn \| undefined` | Get stream function |
| `getReactiveRunFn(taskType)` | `AiProviderReactiveRunFn \| undefined` | Get reactive function |

### QueuedAiProvider (abstract)

| Member | Type | Description |
|--------|------|-------------|
| `queuedStrategy` | `QueuedExecutionStrategy` (protected) | The queue strategy instance |
| `getStrategyForModel(model)` | `IAiExecutionStrategy` (protected) | Override for model-aware routing |
| `createQueuedStrategy(name, concurrency, options)` | `QueuedExecutionStrategy` (protected) | Helper for extra queues |

### AiProviderRegistry

| Method | Description |
|--------|-------------|
| `registerProvider(provider)` | Register a provider instance |
| `unregisterProvider(name)` | Remove a provider and all its functions |
| `getProvider(name)` | Get a provider by name |
| `getProviders()` | Get all providers as a Map |
| `getInstalledProviderIds()` | Sorted list of provider names |
| `getProviderIdsForTask(taskType)` | Providers supporting a task type |
| `registerRunFn(provider, taskType, fn)` | Register a direct run function |
| `registerStreamFn(provider, taskType, fn)` | Register a stream function |
| `registerReactiveRunFn(provider, taskType, fn)` | Register a reactive function |
| `registerAsWorkerRunFn(provider, taskType)` | Register a worker-proxied run function |
| `registerAsWorkerStreamFn(provider, taskType)` | Register a worker-proxied stream function |
| `registerAsWorkerReactiveRunFn(provider, taskType)` | Register a worker-proxied reactive function |
| `getDirectRunFn(provider, taskType)` | Get run function (throws if missing) |
| `getStreamFn(provider, taskType)` | Get stream function (returns undefined) |
| `getReactiveRunFn(provider, taskType)` | Get reactive function (returns undefined) |
| `registerStrategyResolver(provider, resolver)` | Register a strategy resolver |
| `getStrategy(model)` | Resolve execution strategy for a model |

### AiProviderRegisterOptions

| Field | Type | Description |
|-------|------|-------------|
| `worker` | `Worker \| (() => Worker)` | Web Worker for worker-backed mode |
| `queue.concurrency` | `number \| Record<string, number>` | Job queue concurrency |
| `queue.autoCreate` | `boolean` | Whether to auto-create the queue (default: `true`) |

### getAiProviderRegistry() / setAiProviderRegistry(pr)

Access or replace the global `AiProviderRegistry` singleton.
