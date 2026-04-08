<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# The Workglow Job Queue: One API From Prototype to Production

You know the drill. You're building an AI pipeline on your laptop. Everything runs in a single process, inference calls fire sequentially, life is good. Then it's time to deploy, and suddenly you need message brokers, separate worker processes, retry logic, dead letter queues, and three new YAML files. Your clean prototype becomes a distributed systems thesis.

What if it didn't have to?

The Workglow job queue is built around a single idea: **the same code that runs on your laptop should run in production**. No adapter swaps. No infrastructure gymnastics. Just one three-tier architecture that gracefully scales from "everything in one process" to "clients and workers on different machines talking through a database."

Let's walk through how it works.

---

## The Problem: Two Worlds, One Codebase

Most AI frameworks punt on this. They give you a "local mode" for development and a completely different execution path for production. That means:

- Bugs that only appear in one mode
- Integration tests that don't actually test what you deploy
- Developers learning two systems instead of one

Workglow's job queue refuses to split the world in two. Whether your client, server, and workers live in the same `index.ts` file or across three separate machines, the code is structurally identical. The difference is a single line.

---

## Three-Tier Architecture: Client, Server, Worker

The queue has three actors, each with a clear job (pun intended):

**Client** (`JobQueueClient`) -- Submits work, waits for results, tracks progress. Think of it as the "front desk." It doesn't know or care how work gets done.

**Server** (`JobQueueServer`) -- Coordinates everything. Manages a pool of workers, forwards events to clients, recovers stuck jobs on restart, runs cleanup loops for expired entries. The "operations manager."

**Worker** (`JobQueueWorker`) -- Actually does the work. Pulls jobs from the queue, executes them, reports progress, handles retries. The person in the back room who gets things done.

Here's the simplest possible setup:

```typescript
import { Job, JobQueueClient, JobQueueServer, JobQueueWorker } from "@workglow/job-queue";
import { InMemoryQueueStorage } from "@workglow/storage";

// Define your job
class SquareJob extends Job<{ value: number }, { result: number }> {
  async execute(input: { value: number }) {
    return { result: input.value * input.value };
  }
}

// Set up infrastructure
const storage = new InMemoryQueueStorage("math");
await storage.setupDatabase();

const server = new JobQueueServer(SquareJob, {
  storage,
  queueName: "math",
  workerCount: 2,
});

const client = new JobQueueClient({ storage, queueName: "math" });

// The magic line:
client.attach(server);

await server.start();

// Submit and wait
const handle = await client.submit({ value: 7 });
const output = await handle.waitFor();
console.log(output.result); // 49
```

Three classes. One storage backend. Done.

---

## In-Process Optimization: `client.attach(server)`

That `client.attach(server)` call is where the magic happens. When a client is attached directly to a server, events flow through direct method calls instead of storage subscriptions. No polling. No serialization roundtrip. No latency penalty for the convenience of a queue.

Look at what happens inside the server when a job completes:

```typescript
// JobQueueServer.ts -- forwarding events to attached clients
worker.on("job_complete", (jobId, output) => {
  this.stats = { ...this.stats, completedJobs: this.stats.completedJobs + 1 };
  this.events.emit("job_complete", this.queueName, jobId, output);
  this.forwardToClients("handleJobComplete", jobId, output);
});
```

The `forwardToClients` method directly calls `handleJobComplete` on every attached client. No storage read. No subscription event. Just a function call. The client resolves its waiting promise immediately:

```typescript
// JobQueueClient.ts -- resolving promises on completion
public handleJobComplete(jobId: unknown, output: Output): void {
  this.events.emit("job_complete", this.queueName, jobId, output);

  const promises = this.activeJobPromises.get(jobId);
  if (promises) {
    promises.forEach(({ resolve }) => resolve(output));
  }
  this.cleanupJob(jobId);
}
```

When client and server share a process, the overhead of queueing is effectively zero beyond the actual job execution. You get all the benefits of a queue -- retry logic, progress tracking, concurrency limiting -- without paying for distribution you don't need yet.

---

## Cross-Process via Storage: When You Do Need Distribution

Now suppose your workers need to live on a GPU machine while your client lives on a web server. Remove `client.attach(server)` and call `client.connect()` instead:

```typescript
// On the web server
const client = new JobQueueClient({
  storage: new PostgresQueueStorage("ai-jobs", pgPool),
  queueName: "ai-jobs",
});
client.connect();

// On the GPU machine
const server = new JobQueueServer(AiJob, {
  storage: new PostgresQueueStorage("ai-jobs", pgPool),
  queueName: "ai-jobs",
  workerCount: 4,
});
await server.start();
```

When the client isn't attached to a server, it subscribes to storage change notifications. The storage becomes the communication backbone. The client watches for status transitions on its submitted jobs:

```typescript
// JobQueueClient.ts -- reacting to storage changes
private handleStorageChange(change: QueueChangePayload<Input, Output>): void {
  if (change.type === "UPDATE" && change.new) {
    const newStatus = change.new.status;
    const oldStatus = change.old?.status;

    if (newStatus === JobStatus.COMPLETED) {
      this.handleJobComplete(jobId, change.new.output as Output);
    } else if (newStatus === JobStatus.FAILED) {
      this.handleJobError(jobId, change.new.error ?? "Job failed");
    }
    // ... retries, progress updates, etc.
  }
}
```

The exact same `handleJobComplete` path runs whether the event came from an attached server or from a storage subscription. Downstream code can't tell the difference.

Workglow ships queue storage implementations for InMemory, SQLite, PostgreSQL, Supabase, and IndexedDB (browser). Pick the one that matches your deployment, and the queue works.

---

## Job Lifecycle: Six States, No Surprises

A job moves through a well-defined state machine:

```
PENDING  -->  PROCESSING  -->  COMPLETED
   ^              |
   |              v
   +-------- (retry) ------>  FAILED
              |
              v
          ABORTING  -------->  FAILED
                              DISABLED
```

Here's what each state means:

| Status | Meaning |
|---|---|
| `PENDING` | Queued, waiting for a worker to pick it up |
| `PROCESSING` | A worker has claimed it and is executing |
| `COMPLETED` | Finished successfully, output is available |
| `FAILED` | Permanently failed after exhausting retries (or a non-retryable error) |
| `ABORTING` | A client requested cancellation; the worker's `AbortController` fires |
| `DISABLED` | Administratively shut off |

The worker claims a job atomically through `storage.next(workerId)` -- the storage layer handles the `PENDING -> PROCESSING` transition with proper locking so two workers never grab the same job. Each claimed job records the worker's ID, which matters for stuck job recovery (more on that shortly).

---

## Retry Logic: Not All Failures Are Created Equal

This is where Workglow gets opinionated in the right way. The queue distinguishes between two kinds of errors:

**`RetryableJobError`** -- Transient problems. Network timeouts, rate limits (HTTP 429), temporary service outages. The job goes back to `PENDING` with a `runAfter` timestamp and will be retried.

**`PermanentJobError`** -- The job is broken and retrying won't help. Auth failures (401/403), invalid input (400/404), or unknown errors. The job goes straight to `FAILED`.

```typescript
// From JobError.ts
export class RetryableJobError extends JobError {
  constructor(message: string, public retryDate?: Date) {
    super(message);
    this.retryable = true;
  }
}

export class PermanentJobError extends JobError {
  // No retryDate. This is final.
}
```

The worker's `processSingleJob` method handles the branching:

```typescript
if (error instanceof RetryableJobError) {
  if (currentJob.runAttempts >= currentJob.maxRetries) {
    // Retries exhausted -- promote to permanent failure
    await this.failJob(currentJob, new PermanentJobError("Max retries reached"));
  } else {
    await this.rescheduleJob(currentJob, error.retryDate);
  }
} else {
  await this.failJob(job, error);
}
```

When rescheduling, the worker consults the limiter for the next available time, so rate-limited retries don't just slam the API again immediately. The `RateLimiter` class supports exponential backoff with jitter:

```typescript
// RateLimiter.ts
protected addJitter(base: number): number {
  return base + Math.random() * base; // full jitter in [base, 2*base)
}

protected increaseBackoff(): void {
  this.currentBackoffDelay = Math.min(
    this.currentBackoffDelay * this.backoffMultiplier,
    this.maxBackoffDelay  // capped at 10 minutes by default
  );
}
```

Default max retries: 10. Default max backoff: 10 minutes. Both configurable per-job and per-queue.

The server also handles crash recovery. On startup, `fixupJobs()` scans for orphaned jobs -- those stuck in `PROCESSING` or `ABORTING` that don't belong to any of the current server's workers -- and resets them to `PENDING` or `FAILED` depending on their retry count.

---

## Progress Tracking: Real-Time Updates From Worker to Client

Every job execution receives a context with an `updateProgress` callback:

```typescript
async execute(input: MyInput, context: IJobExecuteContext): Promise<MyOutput> {
  await context.updateProgress(10, "Downloading model...");
  const model = await downloadModel(input.modelId);

  await context.updateProgress(50, "Running inference...");
  const result = await model.infer(input.data);

  await context.updateProgress(90, "Post-processing...");
  return postProcess(result);
}
```

The worker persists progress to storage and emits an event. The server forwards that event to attached clients. The client dispatches it to any registered progress listeners:

```typescript
const handle = await client.submit(myInput);

handle.onProgress((progress, message, details) => {
  progressBar.update(progress);
  statusLabel.setText(message);
});

await handle.waitFor();
```

This chain works identically whether the client is attached (direct event forwarding) or connected via storage (change subscription). Progress values are clamped to 0-100 by the worker and cached in the client's `lastKnownProgress` map so late-subscribing listeners can immediately see current state.

---

## How AI Tasks Use It: GPU Serialization via QueuedExecutionStrategy

Now for the real payoff. Workglow's AI layer uses the job queue to solve a classic problem: **you have one GPU and twelve tasks that want to use it simultaneously.**

The `QueuedExecutionStrategy` wraps the entire client-server-worker lifecycle into a single `execute()` call:

```typescript
export class QueuedExecutionStrategy implements IAiExecutionStrategy {
  constructor(
    private readonly queueName: string,
    private readonly concurrency: number = 1
  ) {}

  async execute(jobInput, context, runnerId): Promise<TaskOutput> {
    const { client } = await this.ensureQueue();

    const handle = await client.submit(jobInput, {
      jobRunId: runnerId,
      maxRetries: 10,
    });

    // Wire task abort to job abort
    context.signal.addEventListener("abort", () => handle.abort());

    // Forward progress
    handle.onProgress((progress, message, details) => {
      context.updateProgress(progress, message, details);
    });

    return await handle.waitFor();
  }
}
```

The queue is created lazily on first use with `InMemoryQueueStorage` (no external infrastructure needed) and a `ConcurrencyLimiter` set to the specified concurrency -- typically `1` for GPU-bound providers like HuggingFace Transformers or llama.cpp:

```typescript
const server = new JobQueueServer(AiJob, {
  storage,
  queueName: this.queueName,
  limiter: new ConcurrencyLimiter(this.concurrency),  // concurrency: 1 for GPU
});

client.attach(server);  // Same-process optimization
```

With `concurrency: 1`, only one inference job runs at a time. Others queue up and wait. No GPU memory explosions. No OOM kills. No race conditions.

The `AiJob` class itself is where provider errors get classified into retryable vs. permanent. A 429 from OpenAI? `RetryableJobError` with the retry-after delay parsed from the response. A 401? `PermanentJobError`. A network timeout from a local Ollama instance? Retryable. This classification happens in `classifyProviderError()`, which inspects HTTP status codes, error names, and message patterns to make the right call.

The strategy also handles abort propagation: if a task runner cancels a task (timeout, user abort, DAG short-circuit), the abort signal propagates through the queue to the worker's `AbortController`, which cancels the in-flight provider call.

---

## The Bigger Picture

The limiter system deserves a mention on its own. Beyond `ConcurrencyLimiter`, Workglow ships `RateLimiter` (sliding window with backoff), `EvenlySpacedRateLimiter` (fixed intervals), `DelayLimiter` (minimum gap between jobs), and `CompositeLimiter` (combine any of the above). Need to respect OpenAI's 60-requests-per-minute limit while also capping local GPU concurrency at 1? Compose them.

The server can also dynamically scale workers at runtime:

```typescript
// Start with 2 workers
const server = new JobQueueServer(MyJob, { storage, queueName: "work", workerCount: 2 });
await server.start();

// Scale up during peak hours
await server.scaleWorkers(8);

// Scale back down
await server.scaleWorkers(2);
```

And cleanup is automatic. Configure `deleteAfterCompletionMs`, `deleteAfterFailureMs`, or `deleteAfterDisabledMs` on the server, and old jobs get swept out by the cleanup loop (every 10 seconds by default). Set them to `0` for immediate deletion.

---

## Wrapping Up

The Workglow job queue isn't trying to replace RabbitMQ or AWS SQS. It's solving a different problem: giving you the semantics of a production job queue -- retries, progress, concurrency control, abort propagation -- from the first line of prototype code, without requiring any external infrastructure until you actually need it.

The key design decisions:

1. **Three tiers, one API.** Client, Server, Worker always exist. The deployment topology is configuration, not code.
2. **`attach()` for speed, `connect()` for distribution.** Same behavior, different transport.
3. **Error classification drives retry policy.** `RetryableJobError` vs `PermanentJobError` means the queue makes smart decisions automatically.
4. **Progress is a first-class concept.** Not an afterthought bolted onto logging.
5. **Limiters compose.** Concurrency, rate limits, and delays combine cleanly.

Start with `InMemoryQueueStorage` and `client.attach(server)`. Ship it. When the time comes to distribute, swap the storage and remove the `attach`. Everything else stays the same.

That's one API from prototype to production. No YAML required.
