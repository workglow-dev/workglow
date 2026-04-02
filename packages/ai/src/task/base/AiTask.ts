/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description Base class for AI tasks that delegate execution to a
 * provider-registered strategy (direct or queued).
 */

import { Job } from "@workglow/job-queue";
import {
  Task,
  TaskConfigSchema,
  TaskConfigurationError,
  TaskInput,
  type IExecuteContext,
  type IExecuteReactiveContext,
  type TaskConfig,
  type TaskOutput,
  hasStructuredOutput,
} from "@workglow/task-graph";
import type { DataPortSchema, JsonSchema } from "@workglow/util/schema";
import type { ServiceRegistry } from "@workglow/util";

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

const aiTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface AiTaskInput extends TaskInput {
  model: string | ModelConfig;
}

/**
 * A base class for AI related tasks that use an execution strategy
 * (direct or queued) determined by the provider at registration time.
 *
 * Model resolution is handled automatically by the TaskRunner before execution.
 * By the time execute() is called, input.model is always a ModelConfig object.
 */
export class AiTask<
  Input extends AiTaskInput = AiTaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig<Input> = TaskConfig<Input>,
> extends Task<Input, Output, Config> {
  public static override type: string = "AiTask";

  public static override configSchema(): DataPortSchema {
    return aiTaskConfigSchema;
  }

  // ========================================================================
  // Execution
  // ========================================================================

  override async execute(
    input: Input,
    executeContext: IExecuteContext
  ): Promise<Output | undefined> {
    const model = input.model as ModelConfig;
    if (!model || typeof model !== "object") {
      throw new TaskConfigurationError(
        "AiTask: Model was not resolved to ModelConfig - this indicates a bug in the resolution system"
      );
    }

    const jobInput = await this.getJobInput(input);
    const strategy = getAiProviderRegistry().getStrategy(model);

    const output = await strategy.execute(jobInput, executeContext, this.runConfig.runnerId);
    return output as Output;
  }

  // ========================================================================
  // Job creation
  // ========================================================================

  /**
   * Get the input to submit to the job queue (or direct execution).
   * Transforms the task input to AiJobInput format.
   */
  protected async getJobInput(input: Input): Promise<AiJobInput<Input>> {
    const model = input.model as ModelConfig;

    const runtype = (this.constructor as any).runtype ?? (this.constructor as any).type;

    const jobInput: AiJobInput<Input> = {
      taskType: runtype,
      aiProvider: model.provider,
      taskInput: input as Input & { model: ModelConfig },
    };

    // Attach structured output schema if the task declares it.
    const inputOutputSchema = input.outputSchema as DataPortSchema;
    if (
      inputOutputSchema &&
      typeof inputOutputSchema === "object" &&
      !Array.isArray(inputOutputSchema) &&
      typeof inputOutputSchema.type === "string"
    ) {
      jobInput.outputSchema = inputOutputSchema;
    } else {
      const taskOutputSchema = this.outputSchema();
      if (hasStructuredOutput(taskOutputSchema)) {
        jobInput.outputSchema = taskOutputSchema;
      }
    }

    return jobInput;
  }

  /**
   * Creates a new Job instance for direct execution (without a queue).
   */
  async createJob(input: Input, queueName?: string): Promise<Job<AiJobInput<Input>, Output>> {
    const jobInput = await this.getJobInput(input);
    const resolvedQueueName = queueName ?? (await this.getDefaultQueueName(input));
    if (!resolvedQueueName) {
      throw new TaskConfigurationError("AiTask: Unable to determine queue for AI provider");
    }
    const job = new AiJob<AiJobInput<Input>, Output>({
      queueName: resolvedQueueName,
      jobRunId: this.runConfig.runnerId,
      input: jobInput,
    });
    return job;
  }

  /**
   * Gets the default queue name based on the model's provider.
   */
  protected async getDefaultQueueName(input: Input): Promise<string | undefined> {
    const model = input.model as ModelConfig;
    return model?.provider;
  }

  // ========================================================================
  // Reactive execution
  // ========================================================================

  /**
   * Delegates to a provider-registered reactive run function if one exists,
   * otherwise falls back to the default Task.executeReactive().
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

  // ========================================================================
  // Validation
  // ========================================================================

  /**
   * Validates that model inputs are valid ModelConfig objects.
   */
  public override async validateInput(input: Input): Promise<boolean> {
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

    for (const [key] of modelTaskProperties) {
      const model = input[key];
      if (typeof model === "object" && model !== null) {
        const tasks = (model as ModelConfig).tasks;
        if (Array.isArray(tasks) && tasks.length > 0 && !tasks.includes(this.type)) {
          const modelId = (model as ModelConfig).model_id ?? "(inline config)";
          throw new TaskConfigurationError(
            `AiTask: Model "${modelId}" for '${key}' is not compatible with task '${this.type}'. ` +
              `Model supports: [${tasks.join(", ")}]`
          );
        }
      } else if (model !== undefined && model !== null) {
        throw new TaskConfigurationError(
          `AiTask: Invalid model for '${key}' - expected ModelConfig object but got ${typeof model}. ` +
            `Ensure the model ID was registered in the ModelRepository before running the task.`
        );
      }
    }

    const modelPlainProperties = Object.entries<JsonSchema>(
      (inputSchema.properties || {}) as Record<string, JsonSchema>
    ).filter(([key, schema]) => schemaFormat(schema) === "model");

    for (const [key] of modelPlainProperties) {
      const model = input[key];
      if (model !== undefined && model !== null && typeof model !== "object") {
        throw new TaskConfigurationError(
          `AiTask: Invalid model for '${key}' - expected ModelConfig object but got ${typeof model}. ` +
            `Ensure the model ID was registered in the ModelRepository before running the task.`
        );
      }
    }

    return super.validateInput(input);
  }

  public override async narrowInput(input: Input, registry: ServiceRegistry): Promise<Input> {
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

      // Fetch models for this task type from the repository associated with the given registry.
      // Note: we intentionally avoid using a shared cache here to prevent mixing results
      // from different ServiceRegistry / ModelRepository instances.
      const taskModels: ModelConfig[] = (await modelRepo.findModelsByTask(this.type)) ?? [];

      for (const [key, propSchema] of modelTaskProperties) {
        const requestedModel = input[key];

        if (typeof requestedModel === "string") {
          const found = taskModels?.find((m) => m.model_id === requestedModel);
          if (!found) {
            (input as any)[key] = undefined;
          }
        } else if (typeof requestedModel === "object" && requestedModel !== null) {
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
