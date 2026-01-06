/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  DeReplicateFromSchema,
  JobQueueTaskConfig,
  TaskRegistry,
  TypeReplicateArray,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { AiTask } from "./base/AiTask";
import { TypeModel } from "./base/AiTaskSchemas";

const modelSchema = TypeModel("model");

const UnloadModelInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
  },
  required: ["model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const UnloadModelOutputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
  },
  required: ["model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type UnloadModelTaskRunInput = FromSchema<typeof UnloadModelInputSchema>;
export type UnloadModelTaskRunOutput = FromSchema<typeof UnloadModelOutputSchema>;

/**
 * Unload a model from memory and clear its cache.
 *
 * @remarks
 * This task has a side effect of removing the model from memory and deleting cached files
 */
export class UnloadModelTask extends AiTask<
  UnloadModelTaskRunInput,
  UnloadModelTaskRunOutput,
  JobQueueTaskConfig
> {
  public static type = "UnloadModelTask";
  public static category = "Hidden";
  public static title = "Unload Model";
  public static description = "Unloads and clears cached AI models from memory and storage";
  public static inputSchema(): DataPortSchema {
    return UnloadModelInputSchema satisfies DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return UnloadModelOutputSchema satisfies DataPortSchema;
  }
  public static cacheable = false;
}

TaskRegistry.registerTask(UnloadModelTask);

/**
 * Unload a model from memory and clear its cache.
 *
 * @param input - Input containing model(s) to unload
 * @returns Promise resolving to the unloaded model(s)
 */
export const unloadModel = (input: UnloadModelTaskRunInput, config?: JobQueueTaskConfig) => {
  return new UnloadModelTask({} as UnloadModelTaskRunInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    unloadModel: CreateWorkflow<
      UnloadModelTaskRunInput,
      UnloadModelTaskRunOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.unloadModel = CreateWorkflow(UnloadModelTask);
