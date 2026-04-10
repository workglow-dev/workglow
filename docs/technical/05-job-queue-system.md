<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Job Queue System

## Overview

The Workglow job queue system (`@workglow/job-queue`) provides a robust, three-tier architecture for scheduling, executing, and monitoring asynchronous work. It is the backbone that drives AI task execution, embedding generation, and any long-running computation within the framework. The design separates concerns into three cooperating layers -- **Client**, **Server**, and **Worker** -- so that the same code can operate in-process with direct event forwarding or across process boundaries through storage-backed subscriptions.

Every job passes through a well-defined lifecycle (`PENDING -> PROCESSING -> COMPLETED | FAILED | DISABLED`) with built-in retry logic, progress reporting, abort handling, and pluggable rate limiting. The queue persists its state through the `IQueueStorage` interface, which has concrete implementations for SQLite, PostgreSQL, Supabase, IndexedDB, and in-memory backends.

## Three-Tier Architecture

### Tier 1: JobQueueClient

The client is the public API surface that application code interacts with. It is responsible for submitting jobs, waiting for results, subscribing to progress updates, and aborting running work.

A client can operate in two modes:

1. **Attached (in-process):** The client calls `attach(server)` to register itself with a local `JobQueueServer`. Events flow directly from server to client through in-memory function calls, providing the lowest possible latency.
2. **Connected (cross-process):** The client calls `connect()` to subscribe to storage change notifications. This mode works when the server runs in a different process, a different machine, or even a serverless function -- any topology where both sides share the same backing storage.

```typescript
import { JobQueueClient } from "@workglow/job-queue";

const client = new JobQueueClient({
  storage: queueStorage,
  queueName: "embeddings",
});

// In-process: attach directly to server
client.attach(server);

// Cross-process: connect via storage subscriptions
client.connect();
```

### Tier 2: JobQueueServer

The server is the coordinator. It owns a pool of workers, manages their lifecycle, aggregates statistics, and handles housekeeping tasks such as stuck-job recovery and TTL-based cleanup. When a server starts it:

1. Fixes up orphaned jobs from previous runs (jobs stuck in PROCESSING or ABORTING that are not owned by any current worker).
2. Subscribes to storage change events so it can wake idle workers the moment new work arrives.
3. Starts all workers and begins the periodic cleanup loop.

The server also acts as an event bus, forwarding worker-level events to all attached clients.

```typescript
import { JobQueueServer } from "@workglow/job-queue";

const server = new JobQueueServer(MyJob, {
  storage: queueStorage,
  queueName: "embeddings",
  limiter: concurrencyLimiter,
  workerCount: 4,
  pollIntervalMs: 100,
  deleteAfterCompletionMs: 60_000,
  cleanupIntervalMs: 10_000,
});

await server.start();
```

### Tier 3: JobQueueWorker

Workers are the execution engines. Each worker runs a tight `while` loop that checks the limiter, claims the next available job from storage via `storage.next(workerId)`, and dispatches it for execution. When no work is available, the worker sleeps until either a `notify()` call wakes it (pushed by the server when new work arrives or a slot frees up) or the poll interval expires as a fallback.

Workers process jobs concurrently within themselves. The `processSingleJob` call is not awaited in the main loop, allowing the worker to pick up another job on the next iteration -- subject to limiter approval.

Each worker has a unique `workerId` (UUID by default, or a caller-provided persistent ID). This ID is written into the job record when the worker claims it, enabling the server to distinguish orphaned jobs from jobs actively being processed.

## The Job Class

`Job<Input, Output>` is the base class for all work units. Subclasses override the `execute` method to implement their logic.

```typescript
import { Job } from "@workglow/job-queue";
import type { IJobExecuteContext } from "@workglow/job-queue";

class EmbeddingJob extends Job<EmbeddingInput, EmbeddingOutput> {
  async execute(input: EmbeddingInput, context: IJobExecuteContext): Promise<EmbeddingOutput> {
    // Check for cancellation
    if (context.signal.aborted) {
      throw new AbortSignalJobError("Aborted");
    }

    // Report progress
    await context.updateProgress(50, "Generating embeddings...");

    const result = await generateEmbeddings(input.text);

    await context.updateProgress(100, "Done");
    return { vectors: result };
  }
}
```

### Key Job Properties

| Property | Type | Description |
|---|---|---|
| `id` | `unknown` | Storage-assigned primary key |
| `jobRunId` | `string` | Groups related jobs into a single run |
| `queueName` | `string` | Name of the queue this job belongs to |
| `input` | `Input` | Serializable input payload |
| `output` | `Output \| null` | Result after completion |
| `status` | `JobStatus` | Current lifecycle state |
| `fingerprint` | `string` | Optional deduplication key |
| `maxRetries` | `number` | Maximum retry attempts (default: 10) |
| `runAfter` | `Date` | Earliest time the job may execute |
| `deadlineAt` | `Date \| null` | Hard deadline; job fails if exceeded |
| `runAttempts` | `number` | Number of times the job has been attempted |
| `progress` | `number` | Progress percentage (0-100) |
| `progressMessage` | `string` | Human-readable progress description |
| `workerId` | `string \| null` | ID of the worker that claimed this job |

### IJobExecuteContext

The execution context passed to every `execute` call provides:

- **`signal: AbortSignal`** -- An abort signal that fires when the client calls `abort()` or the worker shuts down. Job implementations should check this signal periodically.
- **`updateProgress(progress, message?, details?)`** -- Async function that persists progress to storage and notifies listeners. Progress values are clamped to 0-100.

## JobHandle

When you submit a job, the client returns a `JobHandle<Output>` -- a lightweight reference that lets you interact with the job without holding the full `Job` object.

```typescript
const handle = await client.submit({ text: "Hello world" }, {
  fingerprint: "hello-world-v1",
  maxRetries: 3,
  deadlineAt: new Date(Date.now() + 60_000),
});

// Wait for result
const output = await handle.waitFor();

// Or subscribe to progress
const unsubscribe = handle.onProgress((progress, message, details) => {
  console.log(`${progress}% - ${message}`);
});

// Or abort
await handle.abort();
```

## Job Lifecycle

```
PENDING ──> PROCESSING ──> COMPLETED
   ^            │
   │            ├──> FAILED
   │            │
   │            ├──> DISABLED
   │            │
   └────────────┘  (retry: back to PENDING with updated runAfter)

Client abort:  PROCESSING ──> ABORTING ──> FAILED (AbortSignalJobError)
```

1. **PENDING** -- The job is in the queue waiting to be picked up. The `runAfter` field controls deferred execution.
2. **PROCESSING** -- A worker has claimed the job and is executing it. The `workerId` field identifies the owner.
3. **COMPLETED** -- Execution succeeded. Output is stored and progress is set to 100.
4. **FAILED** -- Execution failed permanently (PermanentJobError, max retries reached, or abort).
5. **ABORTING** -- The client requested cancellation. The worker detects this state on its next check and fires the abort controller.
6. **DISABLED** -- The job has been administratively disabled and will not be processed.

## Error Handling

The job queue uses a type hierarchy to distinguish retryable from permanent failures:

```
JobError (base)
  ├── RetryableJobError      -- will be retried (e.g., network timeout)
  ├── PermanentJobError       -- will NOT be retried
  │     ├── AbortSignalJobError   -- client-initiated abort
  │     └── JobDisabledError      -- administratively disabled
  └── JobNotFoundError        -- job ID not found in storage
```

### RetryableJobError

When a job throws a `RetryableJobError`, the worker does not mark it as failed. Instead, it checks whether the job has exceeded `maxRetries`. If retries remain, the job is rescheduled to `PENDING` with a new `runAfter` time (derived from the limiter's `getNextAvailableTime()` or the error's optional `retryDate`). If retries are exhausted, the job is marked `FAILED` with a `PermanentJobError("Max retries reached")`.

```typescript
import { RetryableJobError, PermanentJobError } from "@workglow/job-queue";

class ApiCallJob extends Job<ApiInput, ApiOutput> {
  async execute(input: ApiInput, context: IJobExecuteContext): Promise<ApiOutput> {
    try {
      return await callExternalApi(input);
    } catch (err) {
      if (err.status === 429) {
        // Rate limited -- retry after the specified delay
        const retryAfter = new Date(Date.now() + err.retryAfterMs);
        throw new RetryableJobError("Rate limited", retryAfter);
      }
      if (err.status === 401) {
        // Auth failure -- do not retry
        throw new PermanentJobError("Authentication failed");
      }
      throw err; // Unknown errors become PermanentJobError via normalizeError
    }
  }
}
```

### Error Diagnostics

The framework preserves stack traces and error metadata through serialization via `withJobErrorDiagnostics` and `applyPersistedDiagnosticsToStack`. When a client reconstructs an error from storage, the original stack information is restored to aid debugging.

## In-Process vs. Cross-Process Operation

### In-Process (Recommended for Single-Process Apps)

```typescript
const storage = new InMemoryQueueStorage();
await storage.setupDatabase();

const server = new JobQueueServer(MyJob, {
  storage,
  queueName: "work",
  workerCount: 2,
});

const client = new JobQueueClient({ storage, queueName: "work" });
client.attach(server); // Direct event forwarding

await server.start();
const handle = await client.submit({ data: "..." });
const result = await handle.waitFor();
```

### Cross-Process (Separate Client and Server Processes)

```typescript
// -- Server process --
const storage = new SqliteQueueStorage(db, "work_queue");
await storage.setupDatabase();

const server = new JobQueueServer(MyJob, {
  storage,
  queueName: "work",
  workerCount: 4,
});
await server.start();

// -- Client process --
const storage = new SqliteQueueStorage(db, "work_queue");
const client = new JobQueueClient({ storage, queueName: "work" });
client.connect(); // Storage-based subscriptions

const handle = await client.submit({ data: "..." });
const result = await handle.waitFor();
```

## Server Configuration Reference

| Option | Type | Default | Description |
|---|---|---|---|
| `storage` | `IQueueStorage` | (required) | Storage backend for job persistence |
| `queueName` | `string` | (required) | Unique name for this queue |
| `limiter` | `ILimiter` | `NullLimiter` | Rate/concurrency limiter |
| `workerCount` | `number` | `1` | Number of worker instances |
| `pollIntervalMs` | `number` | `100` | Fallback polling interval in ms |
| `deleteAfterCompletionMs` | `number` | `undefined` | TTL for completed jobs (0 = immediate) |
| `deleteAfterFailureMs` | `number` | `undefined` | TTL for failed jobs (0 = immediate) |
| `deleteAfterDisabledMs` | `number` | `undefined` | TTL for disabled jobs (0 = immediate) |
| `cleanupIntervalMs` | `number` | `10000` | How often the cleanup loop runs |

## Dynamic Worker Scaling

The server supports runtime worker scaling:

```typescript
// Scale up to 8 workers
await server.scaleWorkers(8);

// Scale down to 2 workers (excess workers are stopped gracefully)
await server.scaleWorkers(2);

// Check current count
console.log(server.getWorkerCount()); // 2
```

## Queue Statistics

The server tracks aggregate statistics across all workers:

```typescript
const stats = server.getStats();
// {
//   totalJobs: 150,
//   completedJobs: 140,
//   failedJobs: 5,
//   abortedJobs: 2,
//   retriedJobs: 10,
//   disabledJobs: 3,
//   averageProcessingTime: 245.5,  // ms
//   lastUpdateTime: Date
// }
```

## Event System

All three tiers emit typed events. The server aggregates worker events and forwards them to attached clients.

### Client Events

| Event | Parameters | Description |
|---|---|---|
| `job_start` | `(queueName, jobId)` | A job began processing |
| `job_complete` | `(queueName, jobId, output)` | A job completed successfully |
| `job_error` | `(queueName, jobId, error)` | A job failed |
| `job_disabled` | `(queueName, jobId)` | A job was disabled |
| `job_retry` | `(queueName, jobId, runAfter)` | A job was rescheduled for retry |
| `job_progress` | `(queueName, jobId, progress, message, details)` | Progress update |
| `job_aborting` | `(queueName, jobId)` | Abort was requested |

### Server Events

The server emits the same job-level events as the client, plus:

| Event | Parameters | Description |
|---|---|---|
| `server_start` | `(queueName)` | The server started |
| `server_stop` | `(queueName)` | The server stopped |

### Worker Events

| Event | Parameters | Description |
|---|---|---|
| `worker_start` | `()` | The worker started its processing loop |
| `worker_stop` | `()` | The worker stopped |

## API Reference

### Job

- `new Job(params: JobConstructorParam<Input, Output>)` -- Create a job instance.
- `execute(input: Input, context: IJobExecuteContext): Promise<Output>` -- Override this method to implement job logic.
- `updateProgress(progress, message?, details?): Promise<void>` -- Update progress (for direct execution without a worker).
- `onJobProgress(listener): () => void` -- Listen to progress updates (direct execution only).

### JobQueueClient

- `new JobQueueClient(options: JobQueueClientOptions)` -- Create a client.
- `attach(server): void` -- Attach to a local server for in-process optimization.
- `detach(): void` -- Detach from the current server.
- `connect(): void` -- Subscribe to storage for cross-process communication.
- `disconnect(): void` -- Unsubscribe from storage and detach.
- `submit(input, options?): Promise<JobHandle<Output>>` -- Submit a job.
- `submitBatch(inputs, options?): Promise<JobHandle<Output>[]>` -- Submit multiple jobs.
- `getJob(id): Promise<Job | undefined>` -- Retrieve a job by ID.
- `getJobsByRunId(runId): Promise<Job[]>` -- Retrieve jobs by run ID.
- `peek(status?, num?): Promise<Job[]>` -- Peek at queued jobs.
- `size(status?): Promise<number>` -- Get queue size.
- `waitFor(jobId): Promise<Output>` -- Wait for a job to complete.
- `abort(jobId): Promise<void>` -- Abort a job.
- `abortJobRun(jobRunId): Promise<void>` -- Abort all jobs in a run.
- `onJobProgress(jobId, listener): () => void` -- Subscribe to progress for a specific job.
- `on(event, listener): void` / `off(event, listener): void` / `once(event, listener): void` -- Event subscription.

### JobQueueServer

- `new JobQueueServer(jobClass, options: JobQueueServerOptions)` -- Create a server.
- `start(): Promise<this>` -- Start the server and all workers.
- `stop(): Promise<this>` -- Stop the server gracefully.
- `getStats(): JobQueueStats` -- Get aggregate statistics.
- `scaleWorkers(count): Promise<void>` -- Dynamically adjust worker count.
- `isRunning(): boolean` -- Check server status.
- `getWorkerCount(): number` -- Get current worker count.
- `getWorkerIds(): string[]` -- Get IDs of all managed workers.
- `on(event, listener): void` / `off(event, listener): void` -- Event subscription.

### JobQueueWorker

- `new JobQueueWorker(jobClass, options: JobQueueWorkerOptions)` -- Create a worker.
- `start(): Promise<this>` -- Start the processing loop.
- `stop(): Promise<this>` -- Stop the worker and abort active jobs.
- `notify(): void` -- Wake the worker from idle sleep.
- `processNext(): Promise<boolean>` -- Process a single job (manual control).
- `isRunning(): boolean` -- Check worker status.
- `getActiveJobCount(): number` -- Number of jobs currently being processed.
- `getAverageProcessingTime(): number | undefined` -- Average processing time in ms.
- `on(event, listener): void` / `off(event, listener): void` -- Event subscription.
