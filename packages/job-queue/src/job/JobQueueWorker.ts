/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IQueueStorage, JobStatus, JobStorageFormat } from "@workglow/storage";
import {
  EventEmitter,
  getLogger,
  getTelemetryProvider,
  sleep,
  SpanStatusCode,
  uuid4,
} from "@workglow/util";
import { ILimiter } from "../limiter/ILimiter";
import { NullLimiter } from "../limiter/NullLimiter";
import { Job, JobClass } from "./Job";
import {
  AbortSignalJobError,
  JobDisabledError,
  JobError,
  JobNotFoundError,
  PermanentJobError,
  RetryableJobError,
} from "./JobError";
import { withJobErrorDiagnostics } from "./JobErrorDiagnostics";
import { classToStorage, storageToClass } from "./JobStorageConverters";

/**
 * Events emitted by JobQueueWorker
 */
export type JobQueueWorkerEventListeners<Input, Output> = {
  job_start: (jobId: unknown) => void;
  job_complete: (jobId: unknown, output: Output) => void;
  job_error: (jobId: unknown, error: string, errorCode?: string) => void;
  job_disabled: (jobId: unknown) => void;
  job_retry: (jobId: unknown, runAfter: Date) => void;
  job_progress: (
    jobId: unknown,
    progress: number,
    message: string,
    details: Record<string, unknown> | null
  ) => void;
  worker_start: () => void;
  worker_stop: () => void;
};

export type JobQueueWorkerEvents = keyof JobQueueWorkerEventListeners<unknown, unknown>;

/**
 * Options for creating a JobQueueWorker
 */
export interface JobQueueWorkerOptions<Input, Output> {
  readonly storage: IQueueStorage<Input, Output>;
  readonly queueName: string;
  readonly limiter?: ILimiter;
  readonly pollIntervalMs?: number;
  /**
   * Optional worker ID. If not provided, a random UUID will be generated.
   * Use a persistent ID if you want the worker to reclaim its own jobs after restart.
   */
  readonly workerId?: string | null;
}

/**
 * Worker that processes jobs from the queue.
 * Reports progress and completion back to storage.
 */
export class JobQueueWorker<
  Input,
  Output,
  QueueJob extends Job<Input, Output> = Job<Input, Output>,
> {
  public readonly queueName: string;
  public readonly workerId: string;
  protected readonly storage: IQueueStorage<Input, Output>;
  protected readonly jobClass: JobClass<Input, Output>;
  protected readonly limiter: ILimiter;
  protected readonly pollIntervalMs: number;
  protected readonly events = new EventEmitter<JobQueueWorkerEventListeners<Input, Output>>();

  protected running = false;

  /**
   * Resolve function for the idle wait promise.
   * When set, the worker is idle and waiting for either a notification or poll timeout.
   */
  private wakeResolve: (() => void) | null = null;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Abort controllers for active jobs
   */
  protected readonly activeJobAbortControllers: Map<unknown, AbortController> = new Map();

  /**
   * Processing times for statistics
   */
  protected readonly processingTimes: Map<unknown, number> = new Map();

  constructor(jobClass: JobClass<Input, Output>, options: JobQueueWorkerOptions<Input, Output>) {
    this.queueName = options.queueName;
    this.workerId = options.workerId ?? uuid4();
    this.storage = options.storage;
    this.jobClass = jobClass;
    this.limiter = options.limiter ?? new NullLimiter();
    this.pollIntervalMs = options.pollIntervalMs ?? 100;
  }

  /**
   * Start the worker processing loop
   */
  public async start(): Promise<this> {
    if (this.running) {
      return this;
    }
    this.running = true;
    this.events.emit("worker_start");
    this.processJobs();
    return this;
  }

  /**
   * Wake the worker from idle sleep so it checks for jobs immediately.
   * No-op if the worker is not currently idle.
   */
  public notify(): void {
    if (this.wakeResolve) {
      if (this.wakeTimer) {
        clearTimeout(this.wakeTimer);
        this.wakeTimer = null;
      }
      this.wakeResolve();
      this.wakeResolve = null;
    }
  }

  /**
   * Stop the worker and abort any active jobs
   */
  public async stop(): Promise<this> {
    if (!this.running) {
      return this;
    }
    this.running = false;

    // Wake from idle sleep so the loop can exit
    this.notify();

    // Wait for pending operations to settle
    const size = await this.storage.size(JobStatus.PROCESSING);
    const sleepTime = Math.max(100, size * 2);
    await sleep(sleepTime);

    // Abort all active jobs
    for (const controller of this.activeJobAbortControllers.values()) {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }

    await sleep(sleepTime);
    this.events.emit("worker_stop");
    return this;
  }

  /**
   * Process a single job manually (useful for testing or manual control)
   */
  public async processNext(): Promise<boolean> {
    const canProceed = await this.limiter.canProceed();
    if (!canProceed) {
      return false;
    }

    const job = await this.next();
    if (!job) {
      return false;
    }

    await this.processSingleJob(job);
    return true;
  }

  /**
   * Check if the worker is currently running
   */
  public isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the number of active jobs being processed
   */
  public getActiveJobCount(): number {
    return this.activeJobAbortControllers.size;
  }

  /**
   * Get average processing time
   */
  public getAverageProcessingTime(): number | undefined {
    const times = Array.from(this.processingTimes.values());
    if (times.length === 0) return undefined;
    return times.reduce((a, b) => a + b, 0) / times.length;
  }

  // ========================================================================
  // Event handling
  // ========================================================================

  public on<Event extends JobQueueWorkerEvents>(
    event: Event,
    listener: JobQueueWorkerEventListeners<Input, Output>[Event]
  ): void {
    this.events.on(event, listener);
  }

  public off<Event extends JobQueueWorkerEvents>(
    event: Event,
    listener: JobQueueWorkerEventListeners<Input, Output>[Event]
  ): void {
    this.events.off(event, listener);
  }

  // ========================================================================
  // Protected methods
  // ========================================================================

  /**
   * Get the next job from the queue
   */
  protected async next(): Promise<QueueJob | undefined> {
    const job = await this.storage.next(this.workerId);
    if (!job) return undefined;
    return this.storageToClass(job) as QueueJob;
  }

  /**
   * Main job processing loop.
   *
   * Runs as a tight `while` loop (no recursive `setTimeout`) so that
   * back-to-back jobs are picked up with minimal inter-job latency.
   *
   * When no jobs are available the worker sleeps until either:
   * - {@link notify} is called (e.g. because the server saw a new job inserted
   *   or a running job completed and freed a concurrency slot), or
   * - the poll-interval timeout expires (fallback for storages without push
   *   events).
   */
  protected async processJobs(): Promise<void> {
    while (this.running) {
      try {
        // Check for aborting jobs
        await this.checkForAbortingJobs();

        const canProceed = await this.limiter.canProceed();
        if (canProceed) {
          const job = await this.next();
          if (job) {
            // Don't await - process in background to allow concurrent jobs.
            // The loop will re-check canProceed on the next iteration; if the
            // limiter is at capacity it will wait for a notify (fired by the
            // server when a job completes and frees a slot).
            this.processSingleJob(job);
            continue;
          }
        }

        // Either no jobs available or limiter is at capacity — wait for
        // something to change before re-checking.
        if (canProceed) {
          // Queue is empty — sleep until notified of new work or until
          // the next deferred job becomes ready.
          const delay = await this.getIdleDelay();
          await this.waitForWakeOrTimeout(delay);
        } else {
          // At capacity — wait until notified (a job completes and frees a
          // slot) or the poll interval expires as a fallback.
          await this.waitForWakeOrTimeout(this.pollIntervalMs);
        }
      } catch {
        // Don't let transient errors kill the loop
        await sleep(this.pollIntervalMs);
      }
    }
  }

  /**
   * Determine how long to sleep when idle.
   *
   * If there are deferred jobs (status PENDING but `run_after` in the future),
   * returns the time until the earliest one becomes ready, clamped to
   * `pollIntervalMs`. Otherwise returns `pollIntervalMs`.
   */
  private async getIdleDelay(): Promise<number> {
    try {
      const pending = await this.storage.peek(JobStatus.PENDING, 1);
      if (pending.length > 0 && pending[0].run_after) {
        const delay = new Date(pending[0].run_after).getTime() - Date.now();
        if (delay > 0) {
          return Math.min(delay, this.pollIntervalMs);
        }
      }
    } catch {
      // If peek fails, fall back to default
    }
    return this.pollIntervalMs;
  }

  /**
   * Wait for either a {@link notify} call or the given timeout,
   * whichever comes first.
   */
  private waitForWakeOrTimeout(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.wakeTimer = setTimeout(() => {
        this.wakeTimer = null;
        this.wakeResolve = null;
        resolve();
      }, timeoutMs);

      this.wakeResolve = () => {
        resolve();
      };
    });
  }

  /**
   * Check for jobs that have been marked for abort and trigger their abort controllers
   */
  protected async checkForAbortingJobs(): Promise<void> {
    const abortingJobs = await this.storage.peek(JobStatus.ABORTING);
    for (const jobData of abortingJobs) {
      const controller = this.activeJobAbortControllers.get(jobData.id);
      if (controller && !controller.signal.aborted) {
        controller.abort();
      }
    }
  }

  /**
   * Process a single job
   */
  protected async processSingleJob(job: Job<Input, Output>): Promise<void> {
    if (!job || !job.id) {
      throw new JobNotFoundError("Invalid job provided for processing");
    }

    const startTime = Date.now();

    // Start telemetry span for job processing
    const telemetry = getTelemetryProvider();
    const span = telemetry.isEnabled
      ? telemetry.startSpan("workglow.job.process", {
          attributes: {
            "workglow.job.id": String(job.id),
            "workglow.job.queue": this.queueName,
            "workglow.job.worker_id": this.workerId,
            "workglow.job.run_attempt": job.runAttempts,
            "workglow.job.max_retries": job.maxRetries,
          },
        })
      : undefined;

    try {
      await this.validateJobState(job);
      await this.limiter.recordJobStart();

      const abortController = this.createAbortController(job.id);
      this.events.emit("job_start", job.id);

      const output = await this.executeJob(job, abortController.signal);
      await this.completeJob(job, output);

      const elapsed = Date.now() - startTime;
      this.processingTimes.set(job.id, elapsed);

      if (span) {
        span.setAttributes({ "workglow.job.duration_ms": elapsed });
        span.setStatus(SpanStatusCode.OK);
      }
    } catch (err: unknown) {
      const error = this.normalizeError(err);
      let spanErrorMessage = error.message;
      if (error instanceof RetryableJobError) {
        const currentJob = await this.getJob(job.id);
        if (!currentJob) {
          throw new JobNotFoundError(`Job ${job.id} not found`);
        }

        if (currentJob.runAttempts >= currentJob.maxRetries) {
          spanErrorMessage = "Max retries reached";
          await this.failJob(currentJob, new PermanentJobError(spanErrorMessage));
          span?.setStatus(SpanStatusCode.ERROR, spanErrorMessage);
        } else {
          await this.rescheduleJob(currentJob, error.retryDate);
          span?.addEvent("workglow.job.retry", {
            "workglow.job.run_attempt": currentJob.runAttempts,
          });
          span?.setStatus(SpanStatusCode.UNSET);
        }
      } else {
        await this.failJob(job, error);
        span?.setStatus(SpanStatusCode.ERROR, error.message);
      }
      span?.setAttributes({ "workglow.job.error": spanErrorMessage });
    } finally {
      span?.end();
      await this.limiter.recordJobCompletion();
    }
  }

  /**
   * Execute a job with the provided abort signal
   */
  protected async executeJob(job: Job<Input, Output>, signal: AbortSignal): Promise<Output> {
    if (!job) throw new JobNotFoundError("Cannot execute null or undefined job");
    return await job.execute(job.input, {
      signal,
      updateProgress: this.updateProgress.bind(this, job.id),
    });
  }

  /**
   * Update progress for a job
   */
  protected async updateProgress(
    jobId: unknown,
    progress: number,
    message: string = "",
    details: Record<string, unknown> | null = null
  ): Promise<void> {
    // Validate progress value
    progress = Math.max(0, Math.min(100, progress));

    await this.storage.saveProgress(jobId, progress, message, details);
    this.events.emit("job_progress", jobId, progress, message, details);
  }

  /**
   * Mark a job as completed
   */
  protected async completeJob(job: Job<Input, Output>, output?: Output): Promise<void> {
    try {
      job.status = JobStatus.COMPLETED;
      job.progress = 100;
      job.progressMessage = "";
      job.progressDetails = null;
      job.completedAt = new Date();
      job.output = output ?? null;
      job.error = null;
      job.errorCode = null;

      await this.storage.complete(this.classToStorage(job));
      this.events.emit("job_complete", job.id, output as Output);
    } catch (err) {
      getLogger().error("completeJob errored:", { error: err });
    } finally {
      this.cleanupJob(job.id);
    }
  }

  /**
   * Mark a job as failed
   */
  protected async failJob(job: Job<Input, Output>, error: JobError): Promise<void> {
    try {
      job.status = JobStatus.FAILED;
      job.progress = 100;
      job.completedAt = new Date();
      job.progressMessage = "";
      job.progressDetails = null;
      job.error = error.message;
      job.errorCode = error?.constructor?.name ?? null;

      await this.storage.complete(this.classToStorage(job));
      this.events.emit("job_error", job.id, error.message, error.constructor.name);
    } catch (err) {
      getLogger().error("failJob errored:", { error: err });
    } finally {
      this.cleanupJob(job.id);
    }
  }

  /**
   * Mark a job as disabled
   */
  protected async disableJob(job: Job<Input, Output>): Promise<void> {
    try {
      job.status = JobStatus.DISABLED;
      job.progress = 100;
      job.completedAt = new Date();
      job.progressMessage = "";
      job.progressDetails = null;

      await this.storage.complete(this.classToStorage(job));
      this.events.emit("job_disabled", job.id);
    } catch (err) {
      getLogger().error("disableJob errored:", { error: err });
    } finally {
      this.cleanupJob(job.id);
    }
  }

  /**
   * Reschedule a job for retry
   */
  protected async rescheduleJob(job: Job<Input, Output>, retryDate?: Date): Promise<void> {
    try {
      job.status = JobStatus.PENDING;
      const nextAvailableTime = await this.limiter.getNextAvailableTime();
      job.runAfter = retryDate instanceof Date ? retryDate : nextAvailableTime;
      job.progress = 0;
      job.progressMessage = "";
      job.progressDetails = null;
      // Increment runAttempts to keep in-memory object in sync with storage
      // The storage layer will read from DB and increment, so this keeps them aligned
      job.runAttempts = (job.runAttempts ?? 0) + 1;

      await this.storage.complete(this.classToStorage(job));
      this.events.emit("job_retry", job.id, job.runAfter);
    } catch (err) {
      getLogger().error("rescheduleJob errored:", { error: err });
    }
  }

  /**
   * Create an abort controller for a job
   */
  protected createAbortController(jobId: unknown): AbortController {
    if (!jobId) throw new JobNotFoundError("Cannot create abort controller for undefined job");

    if (this.activeJobAbortControllers.has(jobId)) {
      return this.activeJobAbortControllers.get(jobId)!;
    }

    const abortController = new AbortController();
    abortController.signal.addEventListener("abort", () => this.handleAbort(jobId));
    this.activeJobAbortControllers.set(jobId, abortController);
    return abortController;
  }

  /**
   * Handle job abort
   */
  protected async handleAbort(jobId: unknown): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) {
      getLogger().error("handleAbort: job not found", { jobId });
      return;
    }
    const error = new AbortSignalJobError("Job Aborted");
    await this.failJob(job, error);
  }

  /**
   * Get a job by ID
   */
  protected async getJob(id: unknown): Promise<Job<Input, Output> | undefined> {
    const job = await this.storage.get(id);
    if (!job) return undefined;
    return this.storageToClass(job);
  }

  /**
   * Validate job state before processing
   */
  protected async validateJobState(job: Job<Input, Output>): Promise<void> {
    if (job.status === JobStatus.COMPLETED) {
      throw new PermanentJobError(`Job ${job.id} is already completed`);
    }
    if (job.status === JobStatus.FAILED) {
      throw new PermanentJobError(`Job ${job.id} has failed`);
    }
    if (
      job.status === JobStatus.ABORTING ||
      this.activeJobAbortControllers.get(job.id)?.signal.aborted
    ) {
      throw new AbortSignalJobError(`Job ${job.id} is being aborted`);
    }
    if (job.deadlineAt && job.deadlineAt < new Date()) {
      throw new PermanentJobError(`Job ${job.id} has exceeded its deadline`);
    }
    if (job.status === JobStatus.DISABLED) {
      throw new JobDisabledError(`Job ${job.id} has been disabled`);
    }
  }

  /**
   * Normalize errors into JobError instances
   */
  protected normalizeError(err: unknown): JobError {
    if (err instanceof JobError) {
      return err;
    }
    if (err instanceof Error) {
      return new PermanentJobError(withJobErrorDiagnostics(err.message, err));
    }
    return new PermanentJobError(String(err));
  }

  /**
   * Clean up job state after completion/failure
   */
  protected cleanupJob(jobId: unknown): void {
    this.activeJobAbortControllers.delete(jobId);
  }

  /**
   * Convert storage format to Job class
   */
  protected storageToClass(details: JobStorageFormat<Input, Output>): Job<Input, Output> {
    return storageToClass(details, this.jobClass);
  }

  /**
   * Convert Job class to storage format
   */
  protected classToStorage(job: Job<Input, Output>): JobStorageFormat<Input, Output> {
    return classToStorage(job, this.queueName);
  }
}
