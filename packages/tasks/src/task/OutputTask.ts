/**
 * @copyright
 * Copyright 2025 Steven Roussey
 * All Rights Reserved
 */

import { CreateWorkflow, Task, TaskConfig, Workflow, type IExecuteContext, type StreamEvent, type StreamFinish } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util";

export type OutputTaskInput = Record<string, unknown>;
export type OutputTaskOutput = Record<string, unknown>;

export type OutputTaskConfig = TaskConfig;

export class OutputTask extends Task<OutputTaskInput, OutputTaskOutput, OutputTaskConfig> {
  static type = "OutputTask";
  static category = "Flow Control";
  static title = "Output";
  static description = "Ends the workflow";
  static hasDynamicSchemas = true;
  static cacheable = false;

  public static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const as DataPortSchema;
  }

  public static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as const as DataPortSchema;
  }

  public inputSchema(): DataPortSchema {
    return (
      this.config?.inputSchema ?? (this.constructor as typeof OutputTask).inputSchema()
    );
  }

  public outputSchema(): DataPortSchema {
    return (
      this.config?.outputSchema ?? (this.constructor as typeof OutputTask).outputSchema()
    );
  }

  public async execute(input: OutputTaskInput) {
    return input as OutputTaskOutput;
  }

  public async executeReactive(input: OutputTaskInput) {
    return input as OutputTaskOutput;
  }

  /**
   * Stream pass-through: re-yields all events from upstream input streams
   * so downstream consumers see them with near-zero latency, then emits
   * a finish event with the materialized input as data.
   */
  async *executeStream(
    input: OutputTaskInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<OutputTaskOutput>> {
    if (context.inputStreams) {
      for (const [, stream] of context.inputStreams) {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value.type === "finish") continue;
            yield value;
          }
        } finally {
          reader.releaseLock();
        }
      }
    }
    yield { type: "finish", data: input } as StreamFinish<OutputTaskOutput>;
  }
}

/**
 * Module augmentation to register task type in the workflow system
 */
declare module "@workglow/task-graph" {
  interface Workflow {
    output: CreateWorkflow<OutputTaskInput, OutputTaskOutput, OutputTaskConfig>;
  }
}

Workflow.prototype.output = CreateWorkflow(OutputTask);
