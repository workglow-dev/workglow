/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description This file contains the implementation of the JobQueueTask class and its derived classes.
 */

import { Job } from "@workglow/job-queue";
import {
  IExecuteContext,
  JobQueueTask,
  JobQueueTaskConfig,
  TaskConfigurationError,
  TaskInput,
  type TaskOutput,
} from "@workglow/task-graph";
import { type JsonSchema, ServiceRegistry, globalServiceRegistry } from "@workglow/util";

import { AiJob, AiJobInput } from "../../job/AiJob";
import { getGlobalModelRepository, MODEL_REPOSITORY } from "../../model/ModelRegistry";
import type { ModelConfig, ModelRecord } from "../../model/ModelSchema";
import type { ModelRepository } from "../../model/ModelRepository";

function schemaFormat(schema: JsonSchema): string | undefined {
  return typeof schema === "object" && schema !== null && "format" in schema
    ? schema.format
    : undefined;
}

export interface AiSingleTaskInput extends TaskInput {
  model: string | ModelConfig;
}

export interface AiArrayTaskInput extends TaskInput {
  model: string | ModelConfig | (string | ModelConfig)[];
}

/**
 * A base class for AI related tasks that run in a job queue.
 * Extends the JobQueueTask class to provide LLM-specific functionality.
 */
export class AiTask<
  Input extends AiArrayTaskInput = AiArrayTaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends JobQueueTaskConfig = JobQueueTaskConfig,
> extends JobQueueTask<Input, Output, Config> {
  public static type: string = "AiTask";
  private modelCache?: { name: string; model: ModelRecord };
  protected executionRegistry: ServiceRegistry = globalServiceRegistry;

  /**
   * Creates a new AiTask instance
   * @param config - Configuration object for the task
   */
  constructor(input: Input = {} as Input, config: Config = {} as Config) {
    const modelLabel =
      typeof input.model === "string"
        ? input.model
        : Array.isArray(input.model)
          ? undefined
          : typeof input.model === "object" && input.model
            ? input.model.model_id || input.model.title || input.model.provider
            : undefined;
    config.name ||= `${new.target.type || new.target.name}${
      modelLabel ? " with model " + modelLabel : ""
    }`;
    super(input, config);
  }

  /**
   * Override execute to capture the registry from context
   */
  async execute(input: Input, context: IExecuteContext): Promise<Output | undefined> {
    this.executionRegistry = context.registry;
    return super.execute(input, context);
  }

  // ========================================================================
  // Registry access helpers
  // ========================================================================

  /**
   * Gets the model repository from the current execution context registry
   */
  protected getModelRepository(): ModelRepository {
    return this.executionRegistry.get(MODEL_REPOSITORY);
  }

  // ========================================================================
  // Job creation
  // ========================================================================

  /**
   * Get the input to submit to the job queue.
   * Transforms the task input to AiJobInput format.
   * @param input - The task input
   * @returns The AiJobInput to submit to the queue
   */
  protected override async getJobInput(input: Input): Promise<AiJobInput<Input>> {
    if (Array.isArray(input.model)) {
      console.error("AiTask: Model is an array", input);
      throw new TaskConfigurationError(
        "AiTask: Model is an array, only create job for single model tasks"
      );
    }
    const runtype = (this.constructor as any).runtype ?? (this.constructor as any).type;
    const model = await this.getModelConfigForInput(input as AiSingleTaskInput);

    // TODO: if the queue is not memory based, we need to convert to something that can structure clone to the queue
    // const registeredQueue = await this.resolveQueue(input);
    // const queueName = registeredQueue?.server.queueName;

    return {
      taskType: runtype,
      aiProvider: model.provider,
      taskInput: { ...(input as any), model } as Input & { model: ModelConfig },
    };
  }

  /**
   * Resolves a model configuration for the given input.
   *
   * @remarks
   * - If `input.model` is a string, it is resolved via the global model repository.
   * - If `input.model` is already a config object, it is used directly.
   */
  protected async getModelConfigForInput(input: AiSingleTaskInput): Promise<ModelConfig> {
    const modelValue = input.model;
    if (!modelValue) throw new TaskConfigurationError("AiTask: No model found");
    if (typeof modelValue === "string") {
      const modelname = modelValue;
      if (this.modelCache && this.modelCache.name === modelname) {
        return this.modelCache.model;
      }
      const model = await this.getModelRepository().findByName(modelname);
      if (!model) {
        throw new TaskConfigurationError(`AiTask: No model ${modelname} found`);
      }
      this.modelCache = { name: modelname, model };
      return model;
    }
    if (typeof modelValue === "object") {
      return modelValue;
    }
    throw new TaskConfigurationError("AiTask: Invalid model value");
  }

  /**
   * Creates a new Job instance for direct execution (without a queue).
   * @param input - The task input
   * @param queueName - The queue name (if any)
   * @returns Promise<Job> - The created job
   */
  override async createJob(
    input: Input,
    queueName?: string
  ): Promise<Job<AiJobInput<Input>, Output>> {
    const jobInput = await this.getJobInput(input);
    const resolvedQueueName = queueName ?? (await this.getDefaultQueueName(input));
    if (!resolvedQueueName) {
      throw new TaskConfigurationError("JobQueueTask: Unable to determine queue for AI provider");
    }
    const job = new AiJob<AiJobInput<Input>, Output>({
      queueName: resolvedQueueName,
      jobRunId: this.config.runnerId, // could be undefined
      input: jobInput,
    });
    return job;
  }

  protected async getModelForInput(input: AiSingleTaskInput): Promise<ModelRecord> {
    const modelname = input.model;
    if (!modelname) throw new TaskConfigurationError("AiTask: No model name found");
    if (typeof modelname !== "string") {
      throw new TaskConfigurationError("AiTask: Model name is not a string");
    }
    if (this.modelCache && this.modelCache.name === modelname) {
      return this.modelCache.model;
    }
    const model = await this.getModelRepository().findByName(modelname);
    if (!model) {
      throw new TaskConfigurationError(`JobQueueTask: No model ${modelname} found`);
    }
    this.modelCache = { name: modelname, model };
    return model;
  }

  protected override async getDefaultQueueName(input: Input): Promise<string | undefined> {
    if (typeof input.model === "string") {
      const model = await this.getModelForInput(input as AiSingleTaskInput);
      return model.provider;
    }
    if (typeof input.model === "object" && input.model !== null && !Array.isArray(input.model)) {
      return (input.model as ModelConfig).provider;
    }
    return undefined;
  }

  /**
   * Validates that a model name really exists
   * @param schema The schema to validate against
   * @param item The item to validate
   * @returns True if the item is valid, false otherwise
   */
  async validateInput(input: Input): Promise<boolean> {
    // TODO(str): this is very inefficient, we should cache the results, including intermediate results
    const inputSchema = this.inputSchema();
    if (typeof inputSchema === "boolean") {
      if (inputSchema === false) {
        throw new TaskConfigurationError(`AiTask: Input schema is 'false' and accepts no inputs`);
      }
      return true;
    }
    const modelTaskProperties = Object.entries<JsonSchema>(
      (inputSchema.properties || {}) as Record<string, JsonSchema>
    ).filter(([key, schema]) => schemaFormat(schema)?.startsWith("model:"));

    if (modelTaskProperties.length > 0) {
      const taskModels = await getGlobalModelRepository().findModelsByTask(this.type);
      for (const [key, propSchema] of modelTaskProperties) {
        let requestedModels = Array.isArray(input[key]) ? input[key] : [input[key]];
        for (const model of requestedModels) {
          if (typeof model === "string") {
            const foundModel = taskModels?.find((m) => m.model_id === model);
            if (!foundModel) {
              throw new TaskConfigurationError(
                `AiTask: Missing model for '${key}' named '${model}' for task '${this.type}'`
              );
            }
          } else if (typeof model === "object" && model !== null) {
            // Inline configs are accepted without requiring repository access.
            // If 'tasks' is provided, do a best-effort compatibility check.
            const tasks = (model as ModelConfig).tasks;
            if (Array.isArray(tasks) && tasks.length > 0 && !tasks.includes(this.type)) {
              throw new TaskConfigurationError(
                `AiTask: Inline model for '${key}' is not compatible with task '${this.type}'`
              );
            }
          } else {
            throw new TaskConfigurationError(`AiTask: Invalid model for '${key}'`);
          }
        }
      }
    }

    const modelPlainProperties = Object.entries<JsonSchema>(
      (inputSchema.properties || {}) as Record<string, JsonSchema>
    ).filter(([key, schema]) => schemaFormat(schema) === "model");

    if (modelPlainProperties.length > 0) {
      for (const [key, propSchema] of modelPlainProperties) {
        let requestedModels = Array.isArray(input[key]) ? input[key] : [input[key]];
        for (const model of requestedModels) {
          if (typeof model === "string") {
            const foundModel = await this.getModelRepository().findByName(model);
            if (!foundModel) {
              throw new TaskConfigurationError(
                `AiTask: Missing model for "${key}" named "${model}"`
              );
            }
          } else if (typeof model === "object" && model !== null) {
            // Inline configs are accepted without requiring repository access.
          } else {
            throw new TaskConfigurationError(`AiTask: Invalid model for "${key}"`);
          }
        }
      }
    }

    return super.validateInput(input);
  }

  // dataflows can strip some models that are incompatible with the target task
  // if all of them are stripped, then the task will fail in validateInput
  async narrowInput(input: Input): Promise<Input> {
    // TODO(str): this is very inefficient, we should cache the results, including intermediate results
    const inputSchema = this.inputSchema();
    if (typeof inputSchema === "boolean") {
      if (inputSchema === false) {
        throw new TaskConfigurationError(`AiTask: Input schema is 'false' and accepts no inputs`);
      }
      return input;
    }
    const modelTaskProperties = Object.entries<JsonSchema>(
      (inputSchema.properties || {}) as Record<string, JsonSchema>
    ).filter(([key, schema]) => schemaFormat(schema)?.startsWith("model:"));
    if (modelTaskProperties.length > 0) {
      const taskModels = await this.getModelRepository().findModelsByTask(this.type);
      for (const [key, propSchema] of modelTaskProperties) {
        let requestedModels = Array.isArray(input[key]) ? input[key] : [input[key]];
        const requestedStrings = requestedModels.filter(
          (m: unknown): m is string => typeof m === "string"
        );
        const requestedInline = requestedModels.filter(
          (m: unknown): m is ModelConfig => typeof m === "object" && m !== null
        );

        const usingStrings = requestedStrings.filter((model: string) =>
          taskModels?.find((m) => m.model_id === model)
        );

        const usingInline = requestedInline.filter((model: ModelConfig) => {
          const tasks = model.tasks;
          // Filter out inline configs with explicit incompatible tasks arrays
          // This matches the validation logic in validateInput
          if (Array.isArray(tasks) && tasks.length > 0 && !tasks.includes(this.type)) {
            return false;
          }
          return true;
        });

        const combined: (string | ModelConfig)[] = [...usingInline, ...usingStrings];

        // we alter input to be the models that were found for this kind of input
        (input as any)[key] = combined.length > 1 ? combined : combined[0];
      }
    }
    return input;
  }
}
