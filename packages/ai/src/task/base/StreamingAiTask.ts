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
  getStreamingPorts,
  type IExecuteContext,
  type StreamEvent,
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
 *
 * Port annotation: providers yield raw events without a `port` field.
 * This class wraps text-delta events with the correct port from the task's
 * output schema before they reach the TaskRunner.
 */
export class StreamingAiTask<
  Input extends AiSingleTaskInput = AiSingleTaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends JobQueueTaskConfig = JobQueueTaskConfig,
> extends AiTask<Input, Output, Config> {
  public static type: string = "StreamingAiTask";

  /**
   * Streaming execution: creates an AiJob and yields StreamEvents from it.
   * Wraps port-less text-delta events from providers with the port determined
   * by the task's output schema `x-stream` annotations.
   */
  async *executeStream(input: Input, context: IExecuteContext): AsyncIterable<StreamEvent<Output>> {
    const jobInput = await this.getJobInput(input);
    const queueName = await this.getDefaultQueueName(input);

    const job = new AiJob<AiJobInput<Input>, Output>({
      queueName: queueName ?? this.type,
      jobRunId: this.config.runnerId,
      input: jobInput,
    });

    // Resolve the append port(s) from the output schema for wrapping
    const ports = getStreamingPorts(this.outputSchema());
    const defaultPort = ports.length > 0 ? ports[0].port : "text";

    for await (const event of job.executeStream(jobInput, {
      signal: context.signal,
      updateProgress: context.updateProgress.bind(this),
    })) {
      if (event.type === "text-delta") {
        yield { ...event, port: (event as any).port ?? defaultPort } as StreamEvent<Output>;
      } else {
        yield event;
      }
    }
  }
}
