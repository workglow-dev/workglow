/**
 * @copyright
 * Copyright 2025 Steven Roussey
 * All Rights Reserved
 */

import { CreateWorkflow, Task, TaskConfig, Workflow, type IExecuteContext, type StreamEvent, type StreamFinish } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util";

export type InputTaskInput = Record<string, unknown>;
export type InputTaskOutput = Record<string, unknown>;
export type InputTaskConfig = TaskConfig;

export class InputTask extends Task<InputTaskInput, InputTaskOutput, InputTaskConfig> {
  static type = "InputTask";
  static category = "Flow Control";
  static title = "Input";
  static description = "Starts the workflow";
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
      this.config?.inputSchema ?? (this.constructor as typeof InputTask).inputSchema()
    );
  }

  public outputSchema(): DataPortSchema {
    return (
      this.config?.outputSchema ?? (this.constructor as typeof InputTask).outputSchema()
    );
  }

  public async execute(input: InputTaskInput) {
    return input as InputTaskOutput;
  }

  public async executeReactive(input: InputTaskInput) {
    return input as InputTaskOutput;
  }

  /**
   * Stream pass-through: re-yields all events from upstream input streams
   * so downstream consumers see them with near-zero latency, then emits
   * a finish event with the materialized input as data.
   */
  async *executeStream(
    input: InputTaskInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<InputTaskOutput>> {
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
    yield { type: "finish", data: input } as StreamFinish<InputTaskOutput>;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    input: CreateWorkflow<InputTaskInput, InputTaskOutput, InputTaskConfig>;
  }
}

Workflow.prototype.input = CreateWorkflow(InputTask);
