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
  type IExecuteReactiveContext,
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
import { getAiProviderRegistry } from "../../provider/AiProviderRegistry";

function schemaFormat(schema: JsonSchema): string | undefined {
  return typeof schema === "object" && schema !== null && "format" in schema
    ? schema.format
    : undefined;
}

export interface AiSingleTaskInput extends TaskInput {
  model: string | ModelConfig;
}

/**
 * A base class for AI related tasks that run in a job queue.
 * Extends the JobQueueTask class to provide LLM-specific functionality.
 *
 * Model resolution is handled automatically by the TaskRunner before execution.
 * By the time execute() is called, input.model is always a ModelConfig object.
 */
export class AiTask<
  Input extends AiSingleTaskInput = AiSingleTaskInput,
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
        : typeof input.model === "object" && input.model
          ? input.model.model_id || input.model.title || input.model.provider
          : undefined;
    config.title ||= `${new.target.type || new.target.name}${
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
      jobRunId: this.runConfig.runnerId, // could be undefined
      input: jobInput,
    });
    return job;
  }

  /**
   * Gets the default queue name based on the model's provider.
   * After TaskRunner resolution, input.model is a ModelConfig.
   */
  protected override async getDefaultQueueName(input: Input): Promise<string | undefined> {
    const model = input.model as ModelConfig;
    return model?.provider;
  }

  /**
   * Delegates to a provider-registered reactive run function if one exists,
   * otherwise falls back to the default Task.executeReactive() (returns output unchanged).
   *
   * Individual task subclasses that override executeReactive() directly take full
   * precedence -- this base implementation is only reached when no subclass override exists.
   */
  override async executeReactive(
    input: Input,
    output: Output,
    context: IExecuteReactiveContext
  ): Promise<Output | undefined> {
    const model = input.model as ModelConfig | undefined;
    if (model && typeof model === "object" && model.provider) {
      const taskType = (this.constructor as any).runtype ?? (this.constructor as any).type;
      const reactiveFn = getAiProviderRegistry().getReactiveRunFn<Input, Output>(
        model.provider,
        taskType
      );
      if (reactiveFn) {
        return reactiveFn(input, output, model);
      }
    }
    return super.executeReactive(input, output, context);
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
      const model = input[key];
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

    // Find properties with plain model format - just ensure they're objects
    const modelPlainProperties = Object.entries<JsonSchema>(
      (inputSchema.properties || {}) as Record<string, JsonSchema>
    ).filter(([key, schema]) => schemaFormat(schema) === "model");

    for (const [key] of modelPlainProperties) {
      const model = input[key];
      if (model !== undefined && model !== null && typeof model !== "object") {
        throw new TaskConfigurationError(
          `AiTask: Invalid model for '${key}' - expected ModelConfig object`
        );
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
        const requestedModel = input[key];

        if (typeof requestedModel === "string") {
          // Verify string model ID is compatible
          const found = taskModels?.find((m) => m.model_id === requestedModel);
          if (!found) {
            (input as any)[key] = undefined;
          }
        } else if (typeof requestedModel === "object" && requestedModel !== null) {
          // Verify inline config is compatible
          const model = requestedModel as ModelConfig;
          const tasks = model.tasks;
          if (Array.isArray(tasks) && tasks.length > 0 && !tasks.includes(this.type)) {
            (input as any)[key] = undefined;
          }
        }
      }
    }
    return input;
  }
}
