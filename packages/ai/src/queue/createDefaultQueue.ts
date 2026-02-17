/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConcurrencyLimiter, JobQueueClient, JobQueueServer } from "@workglow/job-queue";
import { InMemoryQueueStorage } from "@workglow/storage";
import { TaskInput, TaskOutput, getTaskQueueRegistry } from "@workglow/task-graph";

import type { AiJobInput } from "../job/AiJob";
import { AiJob } from "../job/AiJob";

/**
 * Create and register a default job queue for an AI provider.
 * Uses InMemoryQueueStorage with a ConcurrencyLimiter.
 *
 * Extracted to a separate module to avoid circular dependencies between
 * AiProvider, AiJob, and the storage/job-queue/task-graph packages.
 *
 * @param providerName - Unique provider identifier (used as queue name)
 * @param concurrency - Maximum number of concurrent jobs
 */
export async function createDefaultQueue(providerName: string, concurrency: number): Promise<void> {
  const storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(providerName);
  await storage.setupDatabase();

  const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(AiJob, {
    storage,
    queueName: providerName,
    limiter: new ConcurrencyLimiter(concurrency, 100),
  });

  const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
    storage,
    queueName: providerName,
  });

  client.attach(server);

  getTaskQueueRegistry().registerQueue({ server, client, storage });
  await server.start();
}
