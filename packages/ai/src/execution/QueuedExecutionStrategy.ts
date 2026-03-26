/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConcurrencyLimiter, JobQueueClient, JobQueueServer } from "@workglow/job-queue";
import { InMemoryQueueStorage } from "@workglow/storage";
import {
  getTaskQueueRegistry,
  type RegisteredQueue,
  type IExecuteContext,
  type TaskInput,
  type TaskOutput,
} from "@workglow/task-graph";
import { AiJob, type AiJobInput } from "../job/AiJob";
import type { IAiExecutionStrategy } from "./IAiExecutionStrategy";

/**
 * Executes AI jobs through a job queue with concurrency control.
 * Used by providers that need GPU serialization (e.g., HFT with WebGPU,
 * LlamaCpp).
 *
 * The queue is created lazily on first use and registered in the
 * global TaskQueueRegistry for deduplication.
 */
export class QueuedExecutionStrategy implements IAiExecutionStrategy {
  private currentJobId: unknown;

  constructor(
    private readonly queueName: string,
    private readonly concurrency: number = 1
  ) {}

  async execute(
    jobInput: AiJobInput<TaskInput>,
    context: IExecuteContext,
    runnerId: string | undefined
  ): Promise<TaskOutput> {
    const registeredQueue = await this.ensureQueue();
    const { client } = registeredQueue;

    const handle = await client.submit(jobInput as unknown as TaskInput, {
      jobRunId: runnerId,
      maxRetries: 10,
    });

    this.currentJobId = handle.id;

    const cleanup = handle.onProgress(
      (progress: number, message: string | undefined, details: Record<string, any> | null) => {
        context.updateProgress(progress, message, details);
      }
    );

    try {
      const output = await handle.waitFor();
      return output as TaskOutput;
    } finally {
      cleanup();
    }
  }

  abort(jobId?: unknown): void {
    const id = jobId ?? this.currentJobId;
    if (!id) return;

    const registeredQueue = getTaskQueueRegistry().getQueue(this.queueName);
    if (registeredQueue) {
      registeredQueue.client.abort(id).catch((err) => {
        console.warn(`Failed to abort remote job ${id}`, err);
      });
    }
  }

  private async ensureQueue(): Promise<RegisteredQueue<TaskInput, TaskOutput>> {
    const registry = getTaskQueueRegistry();
    const existing = registry.getQueue<TaskInput, TaskOutput>(this.queueName);
    if (existing) return existing;

    const storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(this.queueName);
    await storage.setupDatabase();

    const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(AiJob, {
      storage,
      queueName: this.queueName,
      limiter: new ConcurrencyLimiter(this.concurrency),
    });

    const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
      storage,
      queueName: this.queueName,
    });

    client.attach(server);

    const registeredQueue = { server, client, storage } as unknown as RegisteredQueue<
      TaskInput,
      TaskOutput
    >;

    try {
      registry.registerQueue(registeredQueue);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("already exists")) {
        const raced = registry.getQueue<TaskInput, TaskOutput>(this.queueName);
        if (raced) return raced;
      }
      throw err;
    }

    await server.start();
    return registeredQueue;
  }
}
