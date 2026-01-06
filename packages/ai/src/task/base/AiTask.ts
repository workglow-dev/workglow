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
  JobQueueTask,
  JobQueueTaskConfig,
  TaskConfigurationError,
  TaskInput,
  type TaskOutput,
} from "@workglow/task-graph";
import { type JsonSchema, type ServiceRegistry } from "@workglow/util";

import { AiJob, AiJobInput } from "../../job/AiJob";
import { MODEL_REPOSITORY } from "../../model/ModelRegistry";
import type { ModelRepository } from "../../model/ModelRepository";
import type { ModelConfig } from "../../model/ModelSchema";

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
 *
 * Model resolution is handled automatically by the TaskRunner before execution.
 * By the time execute() is called, input.model is always a ModelConfig object.
 */
export class AiTask<
  Input extends AiArrayTaskInput = AiArrayTaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends JobQueueTaskConfig = JobQueueTaskConfig,
> extends JobQueueTask<Input, Output, Config> {
  public static type: string = "AiTask";

  /**
   * Creates a new AiTask instance
   * @param config - Configuration object for the task
   */
  constructor(input: Partial<Input> = {}, config: Config = {} as Config) {
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

  // ========================================================================
  // Job creation
  // ========================================================================

  /**
   * Get the input to submit to the job queue.
   * Transforms the task input to AiJobInput format.
   *
   * Note: By the time this is called, input.model has already been resolved
   * to a ModelConfig by the TaskRunner's input resolution system.
   *
   * @param input - The task input (with resolved model)
   * @returns The AiJobInput to submit to the queue
   */
  protected override async getJobInput(input: Input): Promise<AiJobInput<Input>> {
    if (Array.isArray(input.model)) {
      console.error("AiTask: Model is an array", input);
      throw new TaskConfigurationError(
        "AiTask: Model is an array, only create job for single model tasks"
      );
    }

    // Model is guaranteed to be resolved by TaskRunner before this is called
    const model = input.model as ModelConfig;
    if (!model || typeof model !== "object") {
      throw new TaskConfigurationError(
        "AiTask: Model was not resolved to ModelConfig - this indicates a bug in the resolution system"
      );
    }

    const runtype = (this.constructor as any).runtype ?? (this.constructor as any).type;

    return {
      taskType: runtype,
      aiProvider: model.provider,
      taskInput: input as Input & { model: ModelConfig },
    };
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

  /**
   * Gets the default queue name based on the model's provider.
   * After TaskRunner resolution, input.model is a ModelConfig.
   */
  protected override async getDefaultQueueName(input: Input): Promise<string | undefined> {
    if (Array.isArray(input.model)) {
      if (input.model.length === 1) {
        return (input.model[0] as ModelConfig).provider;
      }
      throw new TaskConfigurationError(
        "AiTask: getDefaultQueueName does not support multiple models. Only provide a single model."
      );
    }
    const model = input.model as ModelConfig;
    return model?.provider;
  }

  /**
   * Validates that model inputs are valid ModelConfig objects.
   *
   * Note: By the time this is called, string model IDs have already been
   * resolved to ModelConfig objects by the TaskRunner's input resolution system.
   *
   * @param input The input to validate
   * @returns True if the input is valid
   */
  async validateInput(input: Input): Promise<boolean> {
    const inputSchema = this.inputSchema();
    if (typeof inputSchema === "boolean") {
      if (inputSchema === false) {
        throw new TaskConfigurationError(`AiTask: Input schema is 'false' and accepts no inputs`);
      }
      return true;
    }

    // Find properties with model:TaskName format - need task compatibility check
    const modelTaskProperties = Object.entries<JsonSchema>(
      (inputSchema.properties || {}) as Record<string, JsonSchema>
    ).filter(([key, schema]) => schemaFormat(schema)?.startsWith("model:"));

    for (const [key] of modelTaskProperties) {
      const requestedModels = Array.isArray(input[key]) ? input[key] : [input[key]];
      for (const model of requestedModels) {
        if (typeof model === "object" && model !== null) {
          // Check task compatibility if tasks array is specified
          const tasks = (model as ModelConfig).tasks;
          if (Array.isArray(tasks) && tasks.length > 0 && !tasks.includes(this.type)) {
            throw new TaskConfigurationError(
              `AiTask: Model for '${key}' is not compatible with task '${this.type}'`
            );
          }
        } else if (model !== undefined && model !== null) {
          // Should be a ModelConfig object after resolution
          throw new TaskConfigurationError(
            `AiTask: Invalid model for '${key}' - expected ModelConfig object`
          );
        }
      }
    }

    // Find properties with plain model format - just ensure they're objects
    const modelPlainProperties = Object.entries<JsonSchema>(
      (inputSchema.properties || {}) as Record<string, JsonSchema>
    ).filter(([key, schema]) => schemaFormat(schema) === "model");

    for (const [key] of modelPlainProperties) {
      const requestedModels = Array.isArray(input[key]) ? input[key] : [input[key]];
      for (const model of requestedModels) {
        if (model !== undefined && model !== null && typeof model !== "object") {
          throw new TaskConfigurationError(
            `AiTask: Invalid model for '${key}' - expected ModelConfig object`
          );
        }
      }
    }

    return super.validateInput(input);
  }

  // dataflows can strip some models that are incompatible with the target task
  // if all of them are stripped, then the task will fail in validateInput
  async narrowInput(input: Input, registry: ServiceRegistry): Promise<Input> {
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
      const modelRepo = registry.get<ModelRepository>(MODEL_REPOSITORY);
      const taskModels = await modelRepo.findModelsByTask(this.type);
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
