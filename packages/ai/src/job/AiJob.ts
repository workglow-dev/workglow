/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AbortSignalJobError,
  IJobExecuteContext,
  Job,
  JobStatus,
  PermanentJobError,
  RetryableJobError,
} from "@workglow/job-queue";
import { TaskInput, TaskOutput, type StreamEvent } from "@workglow/task-graph";
import { getLogger } from "@workglow/util/worker";
import type { JsonSchema } from "@workglow/util/schema";
import type { ModelConfig } from "../model/ModelSchema";
import { getAiProviderRegistry } from "../provider/AiProviderRegistry";

/** Default timeout for provider API calls (2 minutes). */
const DEFAULT_AI_TIMEOUT_MS = 120_000;

/**
 * Input data for the AiJob
 */
export interface AiJobInput<Input extends TaskInput = TaskInput> {
  taskType: string;
  aiProvider: string;
  taskInput: Input & { model: ModelConfig };
  /** JSON Schema for structured output, when the task declares x-structured-output. */
  outputSchema?: JsonSchema;
  /** Timeout in milliseconds for the provider API call. Defaults to 120s. */
  timeoutMs?: number;
}

/**
 * Classifies a provider error as retryable or permanent based on known patterns.
 * Returns a RetryableJobError for transient issues (rate limits, network errors,
 * server errors) and a PermanentJobError for non-recoverable issues (auth, not found).
 */
function classifyProviderError(err: unknown, taskType: string, provider: string): Error {
  if (
    err instanceof PermanentJobError ||
    err instanceof RetryableJobError ||
    err instanceof AbortSignalJobError
  ) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);
  const statusMatch = message.match(/\b([45]\d{2})\b/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : undefined;

  // Check for abort/cancellation
  if (err instanceof DOMException && err.name === "AbortError") {
    return new AbortSignalJobError(`Provider call aborted for ${taskType} (${provider})`);
  }

  // Rate limiting (429) — retryable with backoff
  if (status === 429) {
    const retryAfterMatch = message.match(/retry.after[:\s]*(\d+)/i);
    const retryMs = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) * 1000 : 30_000;
    return new RetryableJobError(
      `Rate limited by ${provider} for ${taskType}: ${message}`,
      new Date(Date.now() + retryMs)
    );
  }

  // Auth errors (401, 403) — permanent
  if (status === 401 || status === 403) {
    return new PermanentJobError(`Authentication failed for ${provider} (${taskType}): ${message}`);
  }

  // Not found / invalid request (400, 404) — permanent
  if (status === 400 || status === 404) {
    return new PermanentJobError(`Invalid request to ${provider} for ${taskType}: ${message}`);
  }

  // Server errors (500, 502, 503, 529) — retryable
  if (status && status >= 500) {
    return new RetryableJobError(
      `Server error from ${provider} for ${taskType} (HTTP ${status}): ${message}`
    );
  }

  // Network errors — retryable
  if (
    message.includes("ECONNREFUSED") ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    (err instanceof TypeError && message.includes("fetch"))
  ) {
    return new RetryableJobError(`Network error calling ${provider} for ${taskType}: ${message}`);
  }

  // Timeout errors — retryable
  if (message.includes("timed out") || message.includes("timeout")) {
    return new RetryableJobError(`Timeout calling ${provider} for ${taskType}: ${message}`);
  }

  // Default: treat unknown errors as permanent to avoid infinite retries
  return new PermanentJobError(`Provider ${provider} failed for ${taskType}: ${message}`);
}

/**
 * Extends the base Job class to provide custom execution functionality
 * through a provided function.
 */
export class AiJob<
  Input extends AiJobInput<TaskInput> = AiJobInput<TaskInput>,
  Output extends TaskOutput = TaskOutput,
> extends Job<Input, Output> {
  /**
   * Executes the job using the provided function.
   */
  async execute(input: Input, context: IJobExecuteContext): Promise<Output> {
    if (context.signal.aborted || this.status === JobStatus.ABORTING) {
      throw new AbortSignalJobError("Abort signal aborted before execution of job");
    }

    let abortHandler: (() => void) | undefined;

    try {
      const abortPromise = new Promise<never>((_resolve, reject) => {
        const handler = () => {
          reject(new AbortSignalJobError("Abort signal seen, ending job"));
        };

        context.signal.addEventListener("abort", handler, { once: true });
        abortHandler = () => context.signal.removeEventListener("abort", handler);
      });

      const runFn = async () => {
        const fn = getAiProviderRegistry().getDirectRunFn<Input["taskInput"], Output>(
          input.aiProvider,
          input.taskType
        );
        if (!fn) {
          throw new PermanentJobError(
            `No run function found for task type ${input.taskType} and model provider ${input.aiProvider}`
          );
        }
        const model = input.taskInput.model;
        // Second abort check after resolving run function (covers async gap)
        if (context.signal?.aborted) {
          throw new AbortSignalJobError("Job aborted");
        }

        // Apply timeout via AbortSignal.timeout combined with the caller's signal
        const timeoutMs = input.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const combinedSignal = AbortSignal.any([context.signal, timeoutSignal]);

        return await fn(
          input.taskInput,
          model,
          context.updateProgress,
          combinedSignal,
          input.outputSchema
        );
      };
      const runFnPromise = runFn();

      return await Promise.race([runFnPromise, abortPromise]);
    } catch (err) {
      throw classifyProviderError(err, input.taskType, input.aiProvider);
    } finally {
      // Clean up the abort event listener to prevent memory leaks
      if (abortHandler) {
        abortHandler();
      }
    }
  }

  /**
   * Streaming execution: yields StreamEvents from the provider's stream function.
   * Falls back to non-streaming execute() if no stream function is registered.
   * On mid-stream errors, logs the failure and yields a finish event with any
   * partial data accumulated so far.
   */
  async *executeStream(
    input: Input,
    context: IJobExecuteContext
  ): AsyncIterable<StreamEvent<Output>> {
    if (context.signal.aborted || this.status === JobStatus.ABORTING) {
      throw new AbortSignalJobError("Abort signal aborted before streaming execution of job");
    }

    const streamFn = getAiProviderRegistry().getStreamFn<Input["taskInput"], Output>(
      input.aiProvider,
      input.taskType
    );

    if (!streamFn) {
      const result = await this.execute(input, context);
      yield { type: "finish", data: result } as StreamEvent<Output>;
      return;
    }

    const model = input.taskInput.model;
    let lastFinishData: Output | undefined;

    try {
      for await (const event of streamFn(
        input.taskInput,
        model,
        context.signal,
        input.outputSchema
      )) {
        if (event.type === "finish") {
          lastFinishData = event.data;
        }
        yield event;
      }
    } catch (err) {
      const logger = getLogger();
      logger.warn(
        `AiJob: Stream error for ${input.taskType} (${input.aiProvider}): ${err instanceof Error ? err.message : String(err)}`
      );

      // Yield a finish event with whatever data we accumulated
      if (lastFinishData === undefined) {
        yield { type: "finish", data: {} as Output } as StreamEvent<Output>;
      }

      throw classifyProviderError(err, input.taskType, input.aiProvider);
    }
  }
}
