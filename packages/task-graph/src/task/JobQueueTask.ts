/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Job, JobConstructorParam } from "@workglow/job-queue";
import { GraphAsTask } from "./GraphAsTask";
import { IExecuteContext } from "./ITask";
import { getJobQueueFactory } from "./JobQueueFactory";
import { JobTaskFailedError, TaskConfigurationError } from "./TaskError";
import { TaskEventListeners } from "./TaskEvents";
import { getTaskQueueRegistry, RegisteredQueue } from "./TaskQueueRegistry";
import { TaskConfig, TaskInput, TaskOutput } from "./TaskTypes";

/**
 * Configuration interface for JobQueueTask.
 * Extends the base TaskConfig with job queue specific properties.
 */
export interface JobQueueTaskConfig extends TaskConfig {
  /**
   * Queue selection for the task
   * - `true` (default): create/use the task's default queue
   * - `false`: run directly without queueing (requires `canRunDirectly`)
   * - `string`: use an explicitly registered queue name
   */
  queue?: boolean | string;
}

/**
 * Extended event listeners for JobQueueTask.
 * Adds progress event handling to base task event listeners.
 */
export type JobQueueTaskEventListeners = Omit<TaskEventListeners, "progress"> & {
  progress: (progress: number, message?: string, details?: Record<string, any> | null) => void;
};

/**
 * Abstract base class for tasks that operate within a job queue.
 * Provides functionality for managing job execution, progress tracking, and queue integration.
 *
 * @template Input - Type of input data for the task
 * @template Output - Type of output data produced by the task
 * @template Config - Type of configuration object for the task
 */
export abstract class JobQueueTask<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends JobQueueTaskConfig = JobQueueTaskConfig,
> extends GraphAsTask<Input, Output, Config> {
  static readonly type: string = "JobQueueTask";
  static canRunDirectly = true;

  /** Name of the queue currently processing the task */
  currentQueueName?: string;
  /** ID of the current job being processed */
  currentJobId?: string | unknown;
  /** ID of the current runner being used */
  currentRunnerId?: string;

  public jobClass: new (config: JobConstructorParam<Input, Output>) => Job<Input, Output>;

  constructor(input: Input = {} as Input, config: Config = {} as Config) {
    config.queue ??= true;
    super(input, config);
    this.jobClass = Job as unknown as new (
      config: JobConstructorParam<Input, Output>
    ) => Job<Input, Output>;
  }

  async execute(input: Input, executeContext: IExecuteContext): Promise<Output | undefined> {
    let cleanup: () => void = () => {};

    try {
      if (
        this.config.queue === false &&
        !(this.constructor as typeof JobQueueTask).canRunDirectly
      ) {
        throw new TaskConfigurationError(`${this.type} cannot run directly without a queue`);
      }

      const registeredQueue = await this.resolveQueue(input);

      if (!registeredQueue) {
        // Direct execution without a queue
        if (!(this.constructor as typeof JobQueueTask).canRunDirectly) {
          const queueLabel =
            typeof this.config.queue === "string"
              ? this.config.queue
              : (this.currentQueueName ?? this.type);
          throw new TaskConfigurationError(
            `Queue ${queueLabel} not found, and ${this.type} cannot run directly`
          );
        }
        this.currentJobId = undefined;

        // Create job for direct execution
        const job = await this.createJob(input, this.currentQueueName);
        cleanup = job.onJobProgress(
          (progress: number, message: string, details: Record<string, any> | null) => {
            executeContext.updateProgress(progress, message, details);
          }
        );
        const output = await job.execute(job.input, {
          signal: executeContext.signal,
          updateProgress: executeContext.updateProgress.bind(this),
        });
        return output;
      }

      // Execute via queue
      const { client } = registeredQueue;
      const jobInput = await this.getJobInput(input);
      const handle = await client.submit(jobInput as Input, {
        jobRunId: this.currentRunnerId,
        maxRetries: 10,
      });

      this.currentJobId = handle.id;
      this.currentQueueName = client.queueName;

      cleanup = handle.onProgress((progress, message, details) => {
        executeContext.updateProgress(progress, message, details);
      });

      const output = await handle.waitFor();
      if (output === undefined) {
        throw new TaskConfigurationError("Job disabled, should not happen");
      }

      return output as Output;
    } catch (err: any) {
      throw new JobTaskFailedError(err);
    } finally {
      cleanup();
    }
  }

  /**
   * Get the input to submit to the job queue.
   * Override this method to transform task input to job input.
   * @param input - The task input
   * @returns The input to submit to the job queue
   */
  protected async getJobInput(input: Input): Promise<unknown> {
    return input;
  }

  /**
   * Override this method to create the right job class for direct execution (without a queue).
   * This is used when running the task directly without queueing.
   * @param input - The task input
   * @param queueName - The queue name (if any)
   * @returns Promise<Job> - The created job
   */
  async createJob(input: Input, queueName?: string): Promise<Job<any, Output>> {
    return new this.jobClass({
      queueName: queueName ?? this.currentQueueName,
      jobRunId: this.currentRunnerId, // could be undefined
      input: input,
    });
  }

  protected async resolveQueue(input: Input): Promise<RegisteredQueue<Input, Output> | undefined> {
    const preference = this.config.queue ?? true;

    if (preference === false) {
      this.currentQueueName = undefined;
      return undefined;
    }

    if (typeof preference === "string") {
      const registeredQueue = getTaskQueueRegistry().getQueue<Input, Output>(preference);
      if (registeredQueue) {
        this.currentQueueName = registeredQueue.server.queueName;
        return registeredQueue;
      }
      this.currentQueueName = preference;
      return undefined;
    }

    const queueName = await this.getDefaultQueueName(input);
    if (!queueName) {
      this.currentQueueName = undefined;
      return undefined;
    }

    this.currentQueueName = queueName;

    let registeredQueue = getTaskQueueRegistry().getQueue<Input, Output>(queueName);
    if (!registeredQueue) {
      registeredQueue = await this.createAndRegisterQueue(queueName, input);
      await registeredQueue.server.start();
    }

    return registeredQueue;
  }

  protected async getDefaultQueueName(_input: Input): Promise<string | undefined> {
    return this.type;
  }

  protected async createAndRegisterQueue(
    queueName: string,
    input: Input
  ): Promise<RegisteredQueue<Input, Output>> {
    const factory = getJobQueueFactory();
    let registeredQueue = await factory({
      queueName,
      jobClass: this.jobClass,
      input,
      config: this.config,
      task: this,
    });

    const registry = getTaskQueueRegistry();

    try {
      registry.registerQueue(registeredQueue);
    } catch (err) {
      if (err instanceof Error && err.message.includes("already exists")) {
        const existing = registry.getQueue<Input, Output>(queueName);
        if (existing) {
          registeredQueue = existing;
        }
      } else {
        throw err;
      }
    }

    return registeredQueue;
  }

  /**
   * Aborts the task
   * @returns A promise that resolves when the task is aborted
   */
  async abort(): Promise<void> {
    if (this.currentQueueName && this.currentJobId) {
      const registeredQueue = getTaskQueueRegistry().getQueue(this.currentQueueName);
      if (registeredQueue) {
        await registeredQueue.client.abort(this.currentJobId);
      }
    }
    // Always call the parent abort to ensure the task is properly marked as aborted
    super.abort();
  }
}
