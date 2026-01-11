/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, JobQueueTaskConfig, Workflow } from "@workglow/task-graph";
import { DataPortSchema, FromSchema } from "@workglow/util";
import { AiTask } from "./base/AiTask";
import { TypeModel } from "./base/AiTaskSchemas";

const modelSchema = TypeModel("model:TextClassificationTask");

export const TextClassificationInputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "The text to classify",
    },
    candidateLabels: {
      type: "array",
      items: {
        type: "string",
      },
      title: "Candidate Labels",
      description: "List of candidate labels (optional, if provided uses zero-shot classification)",
      "x-ui-group": "Configuration",
    },
    maxCategories: {
      type: "number",
      minimum: 1,
      maximum: 1000,
      default: 5,
      title: "Max Categories",
      description: "The maximum number of categories to return",
      "x-ui-group": "Configuration",
    },
    model: modelSchema,
  },
  required: ["text", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const TextClassificationOutputSchema = {
  type: "object",
  properties: {
    categories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: {
            type: "string",
            title: "Label",
            description: "The name of the category",
          },
          score: {
            type: "number",
            title: "Score",
            description: "The confidence score for this category",
          },
        },
        required: ["label", "score"],
        additionalProperties: false,
      },
      title: "Categories",
      description: "The classification categories with their scores",
    },
  },
  required: ["categories"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type TextClassificationTaskInput = FromSchema<typeof TextClassificationInputSchema>;
export type TextClassificationTaskOutput = FromSchema<typeof TextClassificationOutputSchema>;

/**
 * Classifies text into categories using language models.
 * Automatically selects between regular and zero-shot classification based on whether candidate labels are provided.
 */
export class TextClassificationTask extends AiTask<
  TextClassificationTaskInput,
  TextClassificationTaskOutput
> {
  public static type = "TextClassificationTask";
  public static category = "AI Text Model";
  public static title = "Text Classifier";
  public static description =
    "Classifies text into categories using language models. Supports zero-shot classification when candidate labels are provided.";
  public static inputSchema(): DataPortSchema {
    return TextClassificationInputSchema as DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return TextClassificationOutputSchema as DataPortSchema;
  }
}


/**
 * Convenience function to run text classifier tasks.
 * Creates and executes a TextClassificationTask with the provided input.
 * @param input The input parameters for text classification (text and model)
 * @returns Promise resolving to the classification categories with scores
 */
export const textClassification = (
  input: TextClassificationTaskInput,
  config?: JobQueueTaskConfig
) => {
  return new TextClassificationTask({} as TextClassificationTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    textClassification: CreateWorkflow<
      TextClassificationTaskInput,
      TextClassificationTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.textClassification = CreateWorkflow(TextClassificationTask);
