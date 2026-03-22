/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { getAiProviderRegistry } from "../provider/AiProviderRegistry";
import type { ModelRecord } from "../model/ModelSchema";

/**
 * A single result item from a model search.
 */
export interface ModelSearchResultItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly record: Partial<ModelRecord>;
  readonly raw: unknown;
}

const ModelSearchInputSchema = {
  type: "object",
  properties: {
    provider: {
      type: "string",
      title: "Provider",
      description: "The model provider to search (e.g. ANTHROPIC, OPENAI, HF_TRANSFORMERS_ONNX)",
    },
    query: {
      type: "string",
      title: "Query",
      description: "Search query string",
    },
  },
  required: ["provider", "query"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const ModelSearchOutputSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          description: { type: "string" },
          record: { type: "object", additionalProperties: true },
          raw: {},
        },
        required: ["id", "label", "description", "record"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ModelSearchTaskInput = FromSchema<typeof ModelSearchInputSchema>;
export type ModelSearchTaskOutput = { results: ModelSearchResultItem[] };

/**
 * Search for models using a provider-specific run function from the AiProviderRegistry.
 */
export class ModelSearchTask extends Task<
  ModelSearchTaskInput,
  ModelSearchTaskOutput,
  TaskConfig
> {
  public static type = "ModelSearchTask";
  public static category = "AI Model";
  public static title = "Model Search";
  public static description = "Search for models using provider-specific search functions";
  public static cacheable = false;

  public static inputSchema(): DataPortSchema {
    return ModelSearchInputSchema satisfies DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return ModelSearchOutputSchema satisfies DataPortSchema;
  }

  async execute(
    input: ModelSearchTaskInput,
    context: IExecuteContext
  ): Promise<ModelSearchTaskOutput> {
    const registry = getAiProviderRegistry();
    const noop = () => {};
    const runFn = registry.getDirectRunFn<ModelSearchTaskInput, ModelSearchTaskOutput>(
      input.provider,
      "ModelSearchTask"
    );
    return runFn(input, undefined, noop, context.signal);
  }
}

/**
 * Search for models using a provider-specific search function.
 */
export const modelSearch = (input: ModelSearchTaskInput, config?: TaskConfig) => {
  return new ModelSearchTask({} as ModelSearchTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    modelSearch: CreateWorkflow<ModelSearchTaskInput, ModelSearchTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.modelSearch = CreateWorkflow(ModelSearchTask);
