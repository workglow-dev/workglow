/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Job, JobConstructorParam, JobQueueClient, JobQueueServer } from "@workglow/job-queue";
import { InMemoryQueueStorage, IQueueStorage } from "@workglow/storage";
import { uuid4 } from "@workglow/util";
import { GraphResultArray } from "../task-graph/TaskGraphRunner";
import { GraphAsTaskRunner } from "./GraphAsTaskRunner";
import type { ExecutionMode, IteratorTask, IteratorTaskConfig } from "./IteratorTask";
import { getTaskQueueRegistry, RegisteredQueue } from "./TaskQueueRegistry";
import type { TaskConfig, TaskInput, TaskOutput } from "./TaskTypes";

/**
 * Job class for iterator task items.
 * Wraps individual iteration execution.
 */
class IteratorItemJob<Input extends TaskInput, Output extends TaskOutput> extends Job<
  Input,
  Output
> {
  /**
   * The task to execute for this iteration.
   */
  private iteratorTask: IteratorTask<Input, Output>;

  /**
   * The index of this iteration.
   */
  private iterationIndex: number;

  constructor(
    params: JobConstructorParam<Input, Output> & {
      iteratorTask: IteratorTask<Input, Output>;
      iterationIndex: number;
    }
  ) {
    super(params);
    this.iteratorTask = params.iteratorTask;
    this.iterationIndex = params.iterationIndex;
  }

  async execute(
    input: Input,
    context: { signal: AbortSignal; updateProgress: (progress: number) => void }
  ): Promise<Output> {
    // This would execute the subgraph for a single item
    // For now, return the input as output (placeholder)
    return input as unknown as Output;
  }
}

/**
 * Custom runner for IteratorTask that handles execution mode and queue integration.
 *
 * This runner manages:
 * - Dynamic queue creation based on execution mode
 * - Concurrency limiting for parallel-limited mode
 * - Sequential execution for sequential mode
 * - Batch grouping for batched mode
 */
export class IteratorTaskRunner<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends IteratorTaskConfig = IteratorTaskConfig,
> extends GraphAsTaskRunner<Input, Output, Config> {
  declare task: IteratorTask<Input, Output, Config>;

  /**
   * The queue used for this iterator's executions.
   */
  protected iteratorQueue?: RegisteredQueue<Input, Output>;

  /**
   * Generated queue name for this iterator instance.
   */
  protected iteratorQueueName?: string;

  // ========================================================================
  // Queue Management
  // ========================================================================

  /**
   * Gets or creates the queue for this iterator based on execution mode.
   */
  protected async getOrCreateIteratorQueue(): Promise<RegisteredQueue<Input, Output> | undefined> {
    const executionMode = this.task.executionMode;

    // Parallel mode doesn't need a queue - just run everything
    if (executionMode === "parallel") {
      return undefined;
    }

    // Check if we already have a queue
    if (this.iteratorQueue) {
      return this.iteratorQueue;
    }

    // Generate queue name
    const queueName =
      this.task.config.queueName ?? `iterator-${this.task.config.id}-${uuid4().slice(0, 8)}`;
    this.iteratorQueueName = queueName;

    // Check registry first
    const existingQueue = getTaskQueueRegistry().getQueue<Input, Output>(queueName);
    if (existingQueue) {
      this.iteratorQueue = existingQueue;
      return existingQueue;
    }

    // Create new queue with appropriate concurrency
    const concurrency = this.getConcurrencyForMode(executionMode);
    this.iteratorQueue = await this.createIteratorQueue(queueName, concurrency);

    return this.iteratorQueue;
  }

  /**
   * Gets the concurrency level for the given execution mode.
   */
  protected getConcurrencyForMode(mode: ExecutionMode): number {
    switch (mode) {
      case "sequential":
        return 1;
      case "parallel-limited":
        return this.task.concurrencyLimit;
      case "batched":
        // For batched mode, we process one batch at a time
        // but items within a batch can be parallel
        return this.task.batchSize;
      case "parallel":
      default:
        return Infinity;
    }
  }

  /**
   * Creates a new queue for iterator execution.
   */
  protected async createIteratorQueue(
    queueName: string,
    concurrency: number
  ): Promise<RegisteredQueue<Input, Output>> {
    const storage = new InMemoryQueueStorage<Input, Output>(queueName);
    await storage.setupDatabase();

    // Create a simple job class for iteration items
    const JobClass = class extends Job<Input, Output> {
      async execute(input: Input): Promise<Output> {
        return input as unknown as Output;
      }
    };

    const server = new JobQueueServer<Input, Output>(JobClass, {
      storage: storage as IQueueStorage<Input, Output>,
      queueName,
      workerCount: Math.min(concurrency, 10), // Cap worker count
    });

    const client = new JobQueueClient<Input, Output>({
      storage: storage as IQueueStorage<Input, Output>,
      queueName,
    });

    client.attach(server);

    const queue: RegisteredQueue<Input, Output> = {
      server,
      client,
      storage: storage as IQueueStorage<Input, Output>,
    };

    // Register the queue
    try {
      getTaskQueueRegistry().registerQueue(queue);
    } catch (err) {
      // Queue might already exist from concurrent creation
      const existing = getTaskQueueRegistry().getQueue<Input, Output>(queueName);
      if (existing) {
        return existing;
      }
      throw err;
    }

    // Start the server
    await server.start();

    return queue;
  }

  // ========================================================================
  // Execution Overrides
  // ========================================================================

  /**
   * Execute the iterator's children based on execution mode.
   */
  protected async executeTaskChildren(input: Input): Promise<GraphResultArray<Output>> {
    const executionMode = this.task.executionMode;

    switch (executionMode) {
      case "sequential":
        return this.executeSequential(input);
      case "parallel-limited":
        return this.executeParallelLimited(input);
      case "batched":
        return this.executeBatched(input);
      case "parallel":
      default:
        // Use default parallel execution from parent
        return super.executeTaskChildren(input);
    }
  }

  /**
   * Execute iterations sequentially (one at a time).
   */
  protected async executeSequential(input: Input): Promise<GraphResultArray<Output>> {
    const tasks = this.task.subGraph.getTasks();
    const results: GraphResultArray<Output> = [];

    for (const task of tasks) {
      if (this.abortController?.signal.aborted) {
        break;
      }

      const taskResult = await task.run(input);
      results.push({
        id: task.config.id,
        type: task.type,
        data: taskResult as Output,
      });
    }

    return results;
  }

  /**
   * Execute iterations with a concurrency limit.
   */
  protected async executeParallelLimited(input: Input): Promise<GraphResultArray<Output>> {
    const tasks = this.task.subGraph.getTasks();
    const results: GraphResultArray<Output> = [];
    const limit = this.task.concurrencyLimit;

    // Process in chunks of 'limit' size
    for (let i = 0; i < tasks.length; i += limit) {
      if (this.abortController?.signal.aborted) {
        break;
      }

      const chunk = tasks.slice(i, i + limit);
      const chunkPromises = chunk.map(async (task) => {
        const taskResult = await task.run(input);
        return {
          id: task.config.id,
          type: task.type,
          data: taskResult as Output,
        };
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Execute iterations in batches.
   */
  protected async executeBatched(input: Input): Promise<GraphResultArray<Output>> {
    const tasks = this.task.subGraph.getTasks();
    const results: GraphResultArray<Output> = [];
    const batchSize = this.task.batchSize;

    // Process in batches
    for (let i = 0; i < tasks.length; i += batchSize) {
      if (this.abortController?.signal.aborted) {
        break;
      }

      const batch = tasks.slice(i, i + batchSize);

      // Execute batch items in parallel
      const batchPromises = batch.map(async (task) => {
        const taskResult = await task.run(input);
        return {
          id: task.config.id,
          type: task.type,
          data: taskResult as Output,
        };
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Emit progress for batch completion
      const progress = Math.round(((i + batch.length) / tasks.length) * 100);
      this.task.emit("progress", progress, `Completed batch ${Math.ceil((i + 1) / batchSize)}`);
    }

    return results;
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  /**
   * Clean up the iterator queue when done.
   */
  protected async cleanup(): Promise<void> {
    if (this.iteratorQueue && this.iteratorQueueName) {
      try {
        this.iteratorQueue.server.stop();
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  }
}
