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
import { TypeCategory, TypeImageInput, TypeModel } from "./base/AiTaskSchemas";
import { AiVisionTask } from "./base/AiVisionTask";

const modelSchema = TypeReplicateArray(TypeModel("model:ImageClassificationTask"));

export const ImageClassificationInputSchema = {
  type: "object",
  properties: {
    image: TypeReplicateArray(TypeImageInput),
    model: modelSchema,
    categories: {
      type: "array",
      items: {
        type: "string",
      },
      title: "Categories",
      description:
        "List of candidate categories (optional, if provided uses zero-shot classification)",
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
  },
  required: ["image", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const ImageClassificationOutputSchema = {
  type: "object",
  properties: {
    categories: {
      oneOf: [
        { type: "array", items: TypeCategory },
        { type: "array", items: { type: "array", items: TypeCategory } },
      ],
      title: "Categories",
      description: "The classification categories with their scores",
    },
  },
  required: ["categories"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageClassificationTaskInput = FromSchema<typeof ImageClassificationInputSchema>;
export type ImageClassificationTaskOutput = FromSchema<typeof ImageClassificationOutputSchema>;
export type ImageClassificationTaskExecuteInput = DeReplicateFromSchema<
  typeof ImageClassificationInputSchema
>;
export type ImageClassificationTaskExecuteOutput = DeReplicateFromSchema<
  typeof ImageClassificationOutputSchema
>;

/**
 * Classifies images into categories using vision models.
 * Automatically selects between regular and zero-shot classification based on whether categories are provided.
 */
export class ImageClassificationTask extends AiVisionTask<
  ImageClassificationTaskInput,
  ImageClassificationTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "ImageClassificationTask";
  public static category = "AI Vision Model";
  public static title = "Image Classification";
  public static description =
    "Classifies images into categories using vision models. Supports zero-shot classification when categories are provided.";
  public static inputSchema(): DataPortSchema {
    return ImageClassificationInputSchema as DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return ImageClassificationOutputSchema as DataPortSchema;
  }
}

TaskRegistry.registerTask(ImageClassificationTask);

/**
 * Convenience function to run image classification tasks.
 * Creates and executes an ImageClassificationTask with the provided input.
 * @param input The input parameters for image classification (image, model, and optional categories)
 * @returns Promise resolving to the classification categories with scores
 */
export const imageClassification = (
  input: ImageClassificationTaskInput,
  config?: JobQueueTaskConfig
) => {
  return new ImageClassificationTask({} as ImageClassificationTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    imageClassification: CreateWorkflow<
      ImageClassificationTaskInput,
      ImageClassificationTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.imageClassification = CreateWorkflow(ImageClassificationTask);
