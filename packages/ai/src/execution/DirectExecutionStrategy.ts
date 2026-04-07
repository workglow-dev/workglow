/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, TaskInput, TaskOutput } from "@workglow/task-graph";
import type { StreamEvent } from "@workglow/task-graph";
import { AiJob } from "../job/AiJob";
import type { AiJobInput } from "../job/AiJob";
import type { IAiExecutionStrategy } from "./IAiExecutionStrategy";

/**
 * Executes AI jobs directly without a queue. Used by API providers
 * (OpenAI, Anthropic, etc.) and local providers that don't require
 * GPU serialization or concurrency control.
 */
export class DirectExecutionStrategy implements IAiExecutionStrategy {
  async execute(
    jobInput: AiJobInput<TaskInput>,
    context: IExecuteContext,
    runnerId: string | undefined
  ): Promise<TaskOutput> {
    const job = new AiJob({
      queueName: jobInput.aiProvider,
      jobRunId: runnerId,
      input: jobInput,
    });

    const cleanup = job.onJobProgress(
      (progress: number, message: string, details: Record<string, any> | null) => {
        context.updateProgress(progress, message, details);
      }
    );

    try {
      return await job.execute(jobInput, {
        signal: context.signal,
        updateProgress: context.updateProgress,
      });
    } finally {
      cleanup();
    }
  }

  async *executeStream(
    jobInput: AiJobInput<TaskInput>,
    context: IExecuteContext,
    runnerId: string | undefined
  ): AsyncIterable<StreamEvent<TaskOutput>> {
    const job = new AiJob({
      queueName: jobInput.aiProvider,
      jobRunId: runnerId,
      input: jobInput,
    });

    yield* job.executeStream(jobInput, {
      signal: context.signal,
      updateProgress: context.updateProgress,
    });
  }

  abort(): void {
    // No-op — abort handled via AbortSignal passed through context
  }
}
