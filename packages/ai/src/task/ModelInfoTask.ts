/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  type IExecuteContext,
  JobQueueTaskConfig,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { ModelConfig } from "../model/ModelSchema";
import { getAiProviderRegistry } from "../provider/AiProviderRegistry";
import { AiTask } from "./base/AiTask";
import { TypeModel } from "./base/AiTaskSchemas";

const modelSchema = TypeModel("model");

const ModelInfoInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
    detail: {
      type: "string",
      enum: ["cached_status", "files", "files_with_metadata"],
      default: "files_with_metadata",
    },
  },
  required: ["model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const ModelInfoOutputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
    is_local: { type: "boolean" },
    is_remote: { type: "boolean" },
    supports_browser: { type: "boolean" },
    supports_node: { type: "boolean" },
    is_cached: { type: "boolean" },
    is_loaded: { type: "boolean" },
    file_sizes: {},
    quantizations: {
      type: "array",
      items: { type: "string" },
      description:
        "Available quantization variants (e.g. fp32, fp16, q8). Only present for models with quantization options.",
    },
  },
  required: [
    "model",
    "is_local",
    "is_remote",
    "supports_browser",
    "supports_node",
    "is_cached",
    "is_loaded",
    "file_sizes",
  ],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ModelInfoTaskInput = FromSchema<typeof ModelInfoInputSchema>;
export type ModelInfoTaskOutput = FromSchema<typeof ModelInfoOutputSchema>;

/**
 * Retrieve runtime metadata about a model: locality, browser support, cache status, and file sizes.
 */
export class ModelInfoTask extends AiTask<
  ModelInfoTaskInput,
  ModelInfoTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "ModelInfoTask";
  public static category = "AI Model";
  public static cacheable = false;
  public static title = "Model Info";
  public static description =
    "Returns runtime information about a model including locality, cache status, and file sizes";
  public static inputSchema(): DataPortSchema {
    return ModelInfoInputSchema satisfies DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return ModelInfoOutputSchema satisfies DataPortSchema;
  }

  async execute(input: ModelInfoTaskInput, context: IExecuteContext): Promise<ModelInfoTaskOutput> {
    const model = input.model as ModelConfig;
    const registry = getAiProviderRegistry();
    const noop = () => {};
    const runFn = registry.getDirectRunFn<ModelInfoTaskInput, ModelInfoTaskOutput>(
      model.provider,
      "ModelInfoTask"
    );
    return runFn(input, model, noop, context.signal);
  }
}

/**
 * Retrieve runtime metadata about a model.
 *
 * @param input - Input containing the model to query
 * @returns Promise resolving to model info including locality and cache status
 */
export const modelInfo = (input: ModelInfoTaskInput, config?: JobQueueTaskConfig) => {
  return new ModelInfoTask({} as ModelInfoTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    modelInfo: CreateWorkflow<ModelInfoTaskInput, ModelInfoTaskOutput, JobQueueTaskConfig>;
  }
}

Workflow.prototype.modelInfo = CreateWorkflow(ModelInfoTask);
