/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description Base class for AI tasks that support streaming output.
 * Extends AiTask with executeStream() that yields StreamEvents from the provider.
 */

import {
  JobQueueTaskConfig,
  type IExecuteContext,
  type StreamEvent,
  type StreamMode,
  type TaskOutput,
} from "@workglow/task-graph";

import { AiJob, AiJobInput } from "../../job/AiJob";
import { AiSingleTaskInput, AiTask } from "./AiTask";

/**
 * A base class for streaming AI tasks.
 * Extends AiTask to provide streaming output via executeStream().
 *
 * Subclasses set `streamMode` to control streaming behavior:
 * - 'append': each chunk is a delta (e.g., new token). Default for text generation.
 * - 'replace': each chunk is a revised full snapshot of the output.
 *
 * The standard execute() method is preserved as a fallback that internally
 * consumes the stream to completion (so non-streaming callers get the same result).
 */
export class StreamingAiTask<
  Input extends AiSingleTaskInput = AiSingleTaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends JobQueueTaskConfig = JobQueueTaskConfig,
> extends AiTask<Input, Output, Config> {
  public static type: string = "StreamingAiTask";
  public static streamable: boolean = true;
  public static streamMode: StreamMode = "append";

  /**
   * Streaming execution: creates an AiJob and yields StreamEvents from it.
   * This is the primary execution path for streaming tasks.
   */
  async *executeStream(input: Input, context: IExecuteContext): AsyncIterable<StreamEvent<Output>> {
    const jobInput = await this.getJobInput(input);
    const queueName = await this.getDefaultQueueName(input);

    const job = new AiJob<AiJobInput<Input>, Output>({
      queueName: queueName ?? this.type,
      jobRunId: this.config.runnerId,
      input: jobInput,
    });

    yield* job.executeStream(jobInput, {
      signal: context.signal,
      updateProgress: context.updateProgress.bind(this),
    });
  }
}
