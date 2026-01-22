/**
 * @copyright
 * Copyright 2025 Steven Roussey
 * All Rights Reserved
 */

import { CreateWorkflow, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util";

export type InputTaskInput = Record<string, unknown>;
export type InputTaskOutput = Record<string, unknown>;
export type InputTaskConfig = TaskConfig & {
  readonly schema: DataPortSchema;
};

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
      (this.config?.extras?.inputSchema as DataPortSchema | undefined) ??
      (this.constructor as typeof InputTask).inputSchema()
    );
  }

  public outputSchema(): DataPortSchema {
    return (
      (this.config?.extras?.outputSchema as DataPortSchema | undefined) ??
      (this.constructor as typeof InputTask).outputSchema()
    );
  }

  public async execute(input: InputTaskInput) {
    return input as InputTaskOutput;
  }

  public async executeReactive(input: InputTaskInput) {
    return input as InputTaskOutput;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    input: CreateWorkflow<InputTaskInput, InputTaskOutput, InputTaskConfig>;
  }
}

Workflow.prototype.input = CreateWorkflow(InputTask);
