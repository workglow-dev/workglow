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
} from "@workglow/job-queue";
import { TaskInput, TaskOutput } from "@workglow/task-graph";
import type { ModelConfig } from "../model/ModelSchema";
import { getAiProviderRegistry } from "../provider/AiProviderRegistry";
import { executeTaskViaV3Model } from "../task/adapters";

/**
 * Input data for the AiJob
 */
export interface AiJobInput<Input extends TaskInput = TaskInput> {
  taskType: string;
  aiProvider: string;
  taskInput: Input & { model: ModelConfig };
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
        const v3Result = await executeTaskViaV3Model(
          input.taskType,
          input.taskInput as unknown as Record<string, unknown>,
          context.signal
        );
        if (v3Result.status === "handled") {
          return v3Result.output as Output;
        }

        if (v3Result.status === "unsupported-task") {
          throw new PermanentJobError(
            `Task type ${input.taskType} is not supported by V3 adapters for provider ${input.aiProvider}`
          );
        }

        // status === "not-registered": fall through to legacy path
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
        if (context.signal?.aborted) {
          throw new AbortSignalJobError("Job aborted");
        }
        return await fn(input.taskInput, model, context.updateProgress, context.signal);
      };
      const runFnPromise = runFn();

      return await Promise.race([runFnPromise, abortPromise]);
    } finally {
      // Clean up the abort event listener to prevent memory leaks
      if (abortHandler) {
        abortHandler();
      }
    }
  }
}
