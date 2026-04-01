/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, IExecuteContext, Task, TaskConfig, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { getAiProviderRegistry } from "../provider/AiProviderRegistry";
import type { ModelRecord } from "../model/ModelSchema";
import { TypeModel } from "./base/AiTaskSchemas";

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

/** Static input schema (serialization, typing). Enum/labels for `provider` are added at runtime via {@link ModelSearchTask.inputSchema}. */
const ModelSearchInputSchema = {
  type: "object",
  properties: {
    provider: {
      type: "string",
      title: "Provider",
      description:
        "Registered AI provider id to use for model search. At runtime the workflow UI lists only providers that support model search.",
    },
    query: {
      type: "string",
      title: "Query",
      description:
        "Optional search string. When omitted or empty, returns all models (provider-specific listing).",
    },
  },
  required: ["provider"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

function buildModelSearchInputSchemaDynamic(): DataPortSchema {
  const registry = getAiProviderRegistry();
  const ids = registry.getProviderIdsForTask("ModelSearchTask");
  const enumLabels: Record<string, string> = {};
  for (const id of ids) {
    enumLabels[id] = registry.getProvider(id)?.displayName ?? id;
  }
  const providerProp: Record<string, unknown> = {
    ...(ModelSearchInputSchema.properties as { provider: Record<string, unknown> }).provider,
  };
  if (ids.length > 0) {
    providerProp.enum = ids;
    providerProp["x-ui-enum-labels"] = enumLabels;
  }
  return {
    type: "object",
    properties: {
      provider: providerProp,
      query: (ModelSearchInputSchema.properties as { query: unknown }).query,
    },
    required: [...ModelSearchInputSchema.required],
    additionalProperties: ModelSearchInputSchema.additionalProperties,
  } as DataPortSchema;
}

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
          record: TypeModel("model"),
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
export class ModelSearchTask extends Task<ModelSearchTaskInput, ModelSearchTaskOutput, TaskConfig> {
  public static override type = "ModelSearchTask";
  public static override category = "AI Model";
  public static override title = "Model Search";
  public static override description = "Search for models using provider-specific search functions";
  public static override cacheable = false;
  public static override hasDynamicSchemas = true;

  public static override inputSchema(): DataPortSchema {
    return ModelSearchInputSchema satisfies DataPortSchema;
  }
  public static override outputSchema(): DataPortSchema {
    return ModelSearchOutputSchema satisfies DataPortSchema;
  }

  public override inputSchema(): DataPortSchema {
    return buildModelSearchInputSchemaDynamic();
  }

  override async execute(
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
