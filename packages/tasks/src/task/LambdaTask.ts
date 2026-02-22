/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  DATAFLOW_ALL_PORTS,
  IExecuteContext,
  IExecuteReactiveContext,
  Task,
  TaskConfig,
  TaskConfigSchema,
  TaskConfigurationError,
  TaskInput,
  TaskOutput,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util";

export const lambdaTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    execute: {},
    executeReactive: {},
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

type LambdaTaskConfig<
  Input extends TaskInput = TaskInput,
  Output extends TaskOutput = TaskOutput,
> = TaskConfig & {
  execute?: (input: Input, context: IExecuteContext) => Promise<Output>;
  executeReactive?: (
    input: Input,
    output: Output,
    context: IExecuteReactiveContext
  ) => Promise<Output>;
};

const inputSchema = {
  type: "object",
  properties: {
    [DATAFLOW_ALL_PORTS]: {
      title: "Input",
      description: "Input data to pass to the function",
    },
  },
  additionalProperties: true,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    [DATAFLOW_ALL_PORTS]: {
      title: "Output",
      description: "The output from the execute function",
    },
  },
  additionalProperties: true,
} as const satisfies DataPortSchema;

export type LambdaTaskInput = Record<string, any>;
export type LambdaTaskOutput = Record<string, any>;
/**
 * LambdaTask provides a way to execute arbitrary functions within the task framework
 * It wraps a provided function and its input into a task that can be integrated
 * into task graphs and workflows
 */
export class LambdaTask<
  Input extends TaskInput = LambdaTaskInput,
  Output extends TaskOutput = LambdaTaskOutput,
  Config extends LambdaTaskConfig<Input, Output> = LambdaTaskConfig<Input, Output>,
> extends Task<Input, Output, Config> {
  public static type = "LambdaTask";
  public static title = "Lambda Task";
  public static description = "A task that wraps a provided function and its input";
  public static category = "Hidden";
  public static cacheable = true;
  public static configSchema(): DataPortSchema {
    return lambdaTaskConfigSchema;
  }
  public static inputSchema() {
    return inputSchema;
  }
  public static outputSchema() {
    return outputSchema;
  }

  constructor(input: Partial<Input> = {}, config: Partial<Config> = {}) {
    if (!config.execute && !config.executeReactive) {
      throw new TaskConfigurationError(
        "LambdaTask must have either execute or executeReactive function in config"
      );
    }
    super(input, config as Config);
  }

  async execute(input: Input, context: IExecuteContext): Promise<Output> {
    if (typeof this.config.execute === "function") {
      return await this.config.execute(input, context);
    }
    return {} as Output;
  }

  /**
   * Executes the provided function with the given input
   * Throws an error if no function is provided or if the provided value is not callable
   */
  async executeReactive(input: Input, output: Output, context: IExecuteReactiveContext) {
    if (typeof this.config.executeReactive === "function") {
      return (await this.config.executeReactive(input, output, context)) ?? output;
    }
    return output;
  }
}

export function process(value: string): string;
export function process(value: number): number;
export function process(value: boolean): string;

// Implementation
export function process(value: string | number | boolean): string | number {
  if (typeof value === "string") return `Processed: ${value}`;
  if (typeof value === "number") return value * 2;
  return value ? "True" : "False";
}
/**
 * Convenience function to create and run a LambdaTask
 */
export function lambda<I extends TaskInput, O extends TaskOutput>(
  fn: (input: I, context: IExecuteContext) => Promise<O>
): Promise<TaskOutput>;
export function lambda<I extends TaskInput, O extends TaskOutput>(
  input: I,
  config?: LambdaTaskConfig<I, O>
): Promise<TaskOutput>;

export function lambda<I extends TaskInput, O extends TaskOutput>(
  input: I | ((input: I, context: IExecuteContext) => Promise<O>),
  config?: LambdaTaskConfig<I, O>
): Promise<TaskOutput> {
  if (typeof input === "function") {
    type Input = Parameters<typeof input>[0];
    const task = new LambdaTask<Input, O>({} as Input, {
      execute: input,
    });
    return task.run();
  }
  const task = new LambdaTask<I, O>(input, config);
  return task.run();
}

declare module "@workglow/task-graph" {
  interface Workflow {
    lambda: CreateWorkflow<
      LambdaTaskInput,
      LambdaTaskOutput,
      LambdaTaskConfig<LambdaTaskInput, LambdaTaskOutput>
    >;
  }
}

Workflow.prototype.lambda = CreateWorkflow(LambdaTask);
