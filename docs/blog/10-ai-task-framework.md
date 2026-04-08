<!--
@license
Copyright 2025 Steven Roussey <sroussey@gmail.com>
SPDX-License-Identifier: Apache-2.0
-->

# One Task API to Rule Them All: Inside Workglow's AI Task Framework

*How we built a single abstraction layer that talks to Claude, GPT-4, Gemini, Ollama, llama.cpp, Hugging Face Transformers in WASM, MediaPipe in the browser, and more -- without losing our minds.*

---

## The Abstraction Challenge

Here is a fun engineering puzzle. You have eight AI providers. Some are cloud APIs that respond in milliseconds. Some run models on a local GPU that can only handle one inference at a time. One of them compiles ONNX models to WebAssembly and runs entirely inside a browser tab. Another does pose detection through TensorFlow MediaPipe, also in the browser, also on the GPU.

Now build a pipeline engine where a user can wire up a `TextGenerationTask`, point it at any of these providers, and have it Just Work. Streaming tokens from Claude? Works. Running Whisper through Transformers.js on WebGPU? Works. Falling back to CPU WASM when there is no GPU? Also works -- and it should use a different concurrency strategy when it does.

This is the problem the `@workglow/ai` package solves. Not by hiding the differences between providers, but by creating a clean separation between *what* a task does, *how* it executes, and *where* the model lives.

Let's walk through the architecture.

## AiTask: The Base Class

Every AI task in Workglow extends `AiTask`, which itself extends the core `Task` from `@workglow/task-graph`. The base class is deceptively simple -- it does three things and does them well.

### 1. Model Resolution

An `AiTask` always has a `model` input. At authoring time, this can be a plain string (a model ID like `"claude-sonnet-4-20250514"`). By the time `execute()` is called, the `TaskRunner` has resolved it into a full `ModelConfig` object containing the provider name, model parameters, and capability metadata:

```typescript
export interface AiTaskInput extends TaskInput {
  model: string | ModelConfig;
}
```

Inside `execute()`, the task trusts that resolution has happened:

```typescript
override async execute(input: Input, context: IExecuteContext): Promise<Output | undefined> {
  const model = input.model as ModelConfig;
  if (!model || typeof model !== "object") {
    throw new TaskConfigurationError(
      "AiTask: Model was not resolved to ModelConfig"
    );
  }

  const jobInput = await this.getJobInput(input);
  const strategy = getAiProviderRegistry().getStrategy(model);
  return await strategy.execute(jobInput, context, this.runConfig.runnerId) as Output;
}
```

Three lines of actual logic. Get the job input. Get the strategy. Execute. The rest is validation. This is the entire execution path for every AI task in the system.

### 2. Entitlement Declaration

AI tasks declare entitlements -- structured permission requests that the runtime can inspect before execution begins. This is how a pipeline UI can show "this workflow will use AI inference" and "this workflow will call claude-sonnet-4-20250514" without running any code:

```typescript
public override entitlements(): TaskEntitlements {
  const base: TaskEntitlement[] = [
    { id: Entitlements.AI_INFERENCE, reason: "Runs AI model inference" },
  ];
  const modelId = typeof this.defaults.model === "string" ? this.defaults.model : undefined;
  if (modelId) {
    base.push({
      id: Entitlements.AI_MODEL,
      reason: `Uses model ${modelId}`,
      resources: [modelId],
    });
  }
  return { entitlements: base };
}
```

The `hasDynamicEntitlements: true` flag tells the engine that entitlements depend on the task's configuration, not just its class.

### 3. Schema-Driven I/O

Model input ports use JSON Schema `format` annotations to encode semantic meaning. A text generation task declares its model port as `format: "model:TextGenerationTask"` -- this tells the model resolution system to only offer models that are registered for text generation. The `validateInput()` method enforces this at runtime, checking the `tasks` array on the resolved `ModelConfig`:

```typescript
const tasks = (model as ModelConfig).tasks;
if (Array.isArray(tasks) && tasks.length > 0 && !tasks.includes(this.type)) {
  throw new TaskConfigurationError(
    `Model "${modelId}" is not compatible with task '${this.type}'`
  );
}
```

This means you literally cannot wire an image segmentation model into a text generation task. The schema prevents it in the UI. The validator catches it at runtime.

## Execution Strategies: Direct vs. Queued

Here is where the architecture gets interesting. `AiTask.execute()` does not call the provider directly. It asks the `AiProviderRegistry` for a *strategy*, and the strategy decides how to run the job.

### DirectExecutionStrategy

Cloud API providers (OpenAI, Anthropic, Gemini, HuggingFace Inference) use `DirectExecutionStrategy`. It creates an `AiJob`, wires up progress reporting, and calls `job.execute()` inline:

```typescript
export class DirectExecutionStrategy implements IAiExecutionStrategy {
  async execute(jobInput, context, runnerId): Promise<TaskOutput> {
    const job = new AiJob({
      queueName: jobInput.aiProvider,
      jobRunId: runnerId,
      input: jobInput,
    });

    const cleanup = job.onJobProgress((progress, message, details) => {
      context.updateProgress(progress, message, details);
    });

    try {
      return await job.execute(jobInput, {
        signal: context.signal,
        updateProgress: context.updateProgress,
      });
    } finally {
      cleanup();
    }
  }
}
```

No queue. No concurrency limiter. Just a direct function call with progress forwarding and abort signal propagation.

### QueuedExecutionStrategy

GPU-bound providers need serialized access. You cannot fire three WebGPU inference calls in parallel -- the GPU will choke. `QueuedExecutionStrategy` creates a proper job queue with a `ConcurrencyLimiter`, submits jobs, and waits for results:

```typescript
export class QueuedExecutionStrategy implements IAiExecutionStrategy {
  constructor(
    private readonly queueName: string,
    private readonly concurrency: number = 1,
    private readonly autoCreate: boolean = true
  ) {}

  async execute(jobInput, context, runnerId): Promise<TaskOutput> {
    if (context.signal.aborted) {
      throw new AbortSignalJobError("The operation was aborted");
    }

    const { client } = await this.ensureQueue();
    const handle = await client.submit(jobInput, {
      jobRunId: runnerId,
      maxRetries: 10,
    });

    // Wire abort signal to queued job
    const onAbort = () => { handle.abort().catch(console.warn); };
    context.signal.addEventListener("abort", onAbort);

    try {
      return await handle.waitFor();
    } finally {
      context.signal.removeEventListener("abort", onAbort);
    }
  }
}
```

The queue is lazily created on first use and registered in a global `TaskQueueRegistry` for deduplication. Race conditions during concurrent creation are handled gracefully -- if two strategy instances try to create the same queue simultaneously, the loser detects the conflict and reuses the winner's queue.

## StreamingAiTask: Port Resolution and Delta Yielding

Text generation tasks do not just return a final string -- they stream tokens. `StreamingAiTask` extends `AiTask` to add `executeStream()`, which yields `StreamEvent` objects.

The clever part is **port resolution**. Providers yield raw events without knowing which output port they correspond to. The task resolves this using `x-stream` annotations in the output schema:

```typescript
// In TextGenerationTask's output schema:
const generatedTextSchema = {
  type: "string",
  title: "Text",
  "x-stream": "append",  // <-- this annotation
};
```

When `StreamingAiTask.executeStream()` receives a `text-delta` event from the provider, it wraps it with the correct port name:

```typescript
async *executeStream(input: Input, context: IExecuteContext) {
  const outSchema = this.outputSchema();
  const ports = getStreamingPorts(outSchema);
  let defaultPort = ports.length > 0 ? ports[0].port : "text";

  for await (const event of strategy.executeStream(jobInput, context, runnerId)) {
    if (event.type === "text-delta") {
      yield { ...event, port: event.port ?? defaultPort };
    } else if (event.type === "object-delta") {
      yield { ...event, port: event.port ?? defaultPort };
    } else {
      yield event;
    }
  }
}
```

Three stream modes are supported:
- **`append`**: Each chunk is a delta (a new token). The runner concatenates them.
- **`object`**: Each chunk is a progressively more complete partial object.
- **`replace`**: Each chunk is a revised full snapshot.

The `TaskRunner` handles accumulation. The provider yields deltas. The task maps ports. Clean separation of concerns.

## AiJob: Error Classification and Abort Propagation

`AiJob` is where provider calls actually happen, and it is where things get messy -- in a good way. It handles two hard problems: error classification and abort propagation.

### Error Classification

Not all errors are created equal. A 429 from OpenAI means "slow down, try again in 30 seconds." A 401 means "your API key is wrong, and retrying will not fix it." `AiJob` classifies every provider error into one of three categories:

```typescript
function classifyProviderError(err: unknown, taskType: string, provider: string): Error {
  // Rate limiting (429) -- retryable with backoff
  if (status === 429) {
    const retryAfterMatch = message.match(/retry.after[:\s]*(\d+)/i);
    const retryMs = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) * 1000 : 30_000;
    return new RetryableJobError(message, new Date(Date.now() + retryMs));
  }

  // Auth errors (401, 403) -- permanent
  if (status === 401 || status === 403) {
    return new PermanentJobError(`Authentication failed for ${provider}`);
  }

  // Server errors (500+) -- retryable
  if (status && status >= 500) {
    return new RetryableJobError(`Server error from ${provider} (HTTP ${status})`);
  }

  // Network errors -- retryable
  if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
    return new RetryableJobError(`Network error calling ${provider}`);
  }

  // Unknown -- permanent (avoid infinite retries)
  return new PermanentJobError(`Provider ${provider} failed: ${message}`);
}
```

This classification drives the job queue's retry logic. A `RetryableJobError` with a `retryAfter` date goes back into the queue. A `PermanentJobError` kills the job immediately. An `AbortSignalJobError` propagates cancellation.

There is even special handling for Hugging Face Transformers ONNX: if a model cache is incomplete (missing `preprocessor_config.json`), the error is marked retryable so the next attempt re-downloads the missing file.

### Abort Signal Propagation

`AiJob` combines two abort signals -- the caller's signal and a timeout signal -- using `AbortSignal.any()`:

```typescript
const timeoutMs = resolveAiJobTimeoutMs(input.aiProvider, input.timeoutMs);
const timeoutSignal = AbortSignal.timeout(timeoutMs);
const combinedSignal = AbortSignal.any([context.signal, timeoutSignal]);

return await fn(input.taskInput, model, context.updateProgress, combinedSignal, outputSchema);
```

Cloud APIs get a 2-minute default timeout. Local inference (llama.cpp, HFT) gets 5 minutes because model downloads and multi-turn tool follow-up take time. Both can be overridden per-task via the `timeout` config.

For streaming, abort handling is even more nuanced. If the stream fails mid-way, `AiJob` yields a finish event with whatever data was accumulated (or an empty object), then re-throws the classified error. The runner decides what to do with partial output.

## Strategy Resolution at Runtime

The most elegant part of the system is how strategy resolution works at the provider level. The `AiProviderRegistry` does not hard-code which strategy a provider uses. Instead, providers register a *resolver function* that receives the full `ModelConfig` and returns the appropriate strategy.

Here is the Hugging Face Transformers provider -- the most complex example because the same provider needs different strategies depending on the device:

```typescript
const GPU_DEVICES = new Set(["webgpu", "gpu", "metal"]);

export class HuggingFaceTransformersQueuedProvider extends QueuedAiProvider {
  private cpuStrategy: IAiExecutionStrategy | undefined;

  protected override async afterRegister(options) {
    await super.afterRegister(options);  // Creates the GPU queue (concurrency: 1)
    this.cpuStrategy = this.createQueuedStrategy(
      HF_TRANSFORMERS_ONNX_CPU,
      4,  // CPU can handle 4 concurrent ONNX jobs
      options
    );
  }

  protected override getStrategyForModel(model: ModelConfig): IAiExecutionStrategy {
    const device = model.provider_config?.device;
    if (device && GPU_DEVICES.has(device)) {
      return this.queuedStrategy!;  // GPU: concurrency 1
    }
    return this.cpuStrategy!;        // CPU/WASM: concurrency 4
  }
}
```

Same provider. Same task types. Different execution strategies based on a field in the model config. The task code does not know or care. It calls `strategy.execute()` and the right thing happens.

## Graceful Degradation

What happens when you call `executeStream()` on a `QueuedExecutionStrategy`? Job queues do not support streaming outputs -- they are fire-and-forget by design. The queued strategy handles this gracefully:

```typescript
// QueuedExecutionStrategy
async *executeStream(jobInput, context, runnerId) {
  const result = await this.execute(jobInput, context, runnerId);
  yield { type: "finish", data: result };
}
```

It falls back to non-streaming execution and yields a single `finish` event with the complete result. GPU serialization is preserved. The caller gets the same interface. The user sees the result appear all at once instead of token-by-token, but the pipeline does not break.

Similarly, `AiJob.executeStream()` checks if a streaming function is registered for the provider. If not, it falls back to `execute()`:

```typescript
// AiJob.executeStream()
const streamFn = getAiProviderRegistry().getStreamFn(input.aiProvider, input.taskType);

if (!streamFn) {
  const result = await this.execute(input, context);
  yield { type: "finish", data: result };
  return;
}
```

Graceful degradation at every layer. The system works with the best available capability and degrades to the simplest common denominator when needed.

## The Design Principle: Providers Are Stateless, Runners Accumulate

There is a single design principle that makes the entire streaming architecture work, and it is worth stating explicitly:

**Provider stream functions must not accumulate output.**

They yield incremental `text-delta` events. They yield `object-delta` events. And they yield a final `finish` event with `{} as Output`. That is it. No internal buffers. No accumulated strings. No state between events.

The consumer -- `StreamingAiTask`, the `TaskRunner`, the `TaskGraphRunner` -- is responsible for accumulating deltas into the final output. This separation keeps providers stateless and avoids double-buffering. It means a provider can be swapped, restarted, or run in a Web Worker without coordinating state with the main thread.

This principle is enforced by convention and code review, not by the type system. The type signatures allow providers to return accumulated data in `finish` events. But the architecture relies on them not doing so. The `CLAUDE.md` in the repository makes this explicit:

> *Providers that cannot natively stream should fall back to execute() and yield a single finish event so that GPU-serialization is still respected.*

## Putting It All Together

Let's trace a complete execution. A user creates a `TextGenerationTask` pointed at a Hugging Face model running on WebGPU:

1. The `TaskRunner` resolves the model string `"Xenova/Phi-3-mini-4k-instruct"` into a `ModelConfig` with `provider: "HF_TRANSFORMERS_ONNX"` and `provider_config.device: "webgpu"`.

2. `StreamingAiTask.executeStream()` calls `getAiProviderRegistry().getStrategy(model)`.

3. The registry finds the HFT strategy resolver, which checks the device field and returns the GPU `QueuedExecutionStrategy` (concurrency: 1).

4. The queued strategy submits an `AiJob` to its job queue and waits.

5. When the GPU is available, the job queue dequeues the job and calls `AiJob.execute()`.

6. The job resolves the provider's run function from the registry and calls it with a combined abort+timeout signal.

7. The run function (which executes in a Web Worker) calls Transformers.js, runs the model, and returns the output.

8. Since the queued strategy does not support streaming, `executeStream()` falls back: it runs the full job and yields a single `finish` event.

9. The `TaskRunner` receives the finish event, sets the output, marks the task COMPLETED.

Now change the model to `"claude-sonnet-4-20250514"`. Steps 1-2 are the same. At step 3, no strategy resolver is registered for Anthropic (it is a cloud API), so the registry returns the default `DirectExecutionStrategy`. At step 4, the direct strategy creates an `AiJob` inline. At step 6, the job calls Anthropic's streaming function. At step 7, tokens start flowing as `text-delta` events. The `StreamingAiTask` wraps each one with `port: "text"` (resolved from `x-stream: "append"` in the schema). The runner accumulates them into the final output string.

Same task class. Same pipeline. Same API. Completely different execution paths, chosen automatically based on the model configuration.

That is the power of the strategy pattern combined with a clean provider registry. The task author writes `execute()` once. The framework handles the rest.

---

*Workglow is open source under the Apache-2.0 license. Explore the AI task framework in `packages/ai/src/` and the provider implementations in `packages/ai-provider/src/`.*
