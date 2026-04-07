/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description Base class for AI tasks that support streaming output.
 * Extends AiTask with executeStream() that yields StreamEvents from the provider.
 */

import { getStreamingPorts, TaskConfigurationError } from "@workglow/task-graph";
import type { TaskConfig, IExecuteContext, StreamEvent, TaskOutput } from "@workglow/task-graph";

import { AiTask } from "./AiTask";
import type { AiTaskInput } from "./AiTask";
import { getAiProviderRegistry } from "../../provider/AiProviderRegistry";
import type { ModelConfig } from "../../model/ModelSchema";

/**
 * A base class for streaming AI tasks.
 * Extends AiTask to provide streaming output via executeStream().
 *
 * Subclasses set `streamMode` to control streaming behavior:
 * - 'append': each chunk is a delta (e.g., a new token). Default for text generation.
 * - 'object': each chunk is a progressively more complete partial object.
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
  Input extends AiTaskInput = AiTaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig<Input> = TaskConfig<Input>,
> extends AiTask<Input, Output, Config> {
  public static override type: string = "StreamingAiTask";

  /**
   * Streaming execution: resolves the provider strategy and yields StreamEvents from it.
   * Routes through the same strategy as execute() (queued vs direct) so GPU
   * serialization is respected even for streaming tasks.
   *
   * Wraps port-less text-delta and object-delta events from providers with
   * the port determined by the task's output schema `x-stream` annotations.
   */
  async *executeStream(input: Input, context: IExecuteContext): AsyncIterable<StreamEvent<Output>> {
    const model = input.model as ModelConfig;
    if (!model || typeof model !== "object") {
      throw new TaskConfigurationError(
        "StreamingAiTask: Model was not resolved to ModelConfig - this indicates a bug in the resolution system"
      );
    }
    const jobInput = await this.getJobInput(input);
    const strategy = getAiProviderRegistry().getStrategy(model);

    // Resolve the streaming port(s) from the output schema for wrapping.
    // Falls back to the first property in the output schema rather than
    // hardcoding "text", so non-text streaming tasks work correctly.
    const outSchema = this.outputSchema();
    const ports = getStreamingPorts(outSchema);
    let defaultPort = "text";
    if (ports.length > 0) {
      defaultPort = ports[0].port;
    } else {
      if (typeof outSchema === "object" && outSchema.properties) {
        const firstProp = Object.keys(outSchema.properties)[0];
        if (firstProp) defaultPort = firstProp;
      }
    }

    for await (const event of strategy.executeStream(jobInput, context, this.runConfig.runnerId)) {
      if (event.type === "text-delta") {
        yield { ...event, port: event.port ?? defaultPort } as StreamEvent<Output>;
      } else if (event.type === "object-delta") {
        yield { ...event, port: event.port ?? defaultPort } as StreamEvent<Output>;
      } else {
        yield event as StreamEvent<Output>;
      }
    }
  }
}
