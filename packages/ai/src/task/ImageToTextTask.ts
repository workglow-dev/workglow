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
import { TypeImageInput, TypeModel } from "./base/AiTaskSchemas";
import { AiVisionTask } from "./base/AiVisionTask";

const modelSchema = TypeReplicateArray(TypeModel("model:ImageToTextTask"));

const generatedTextSchema = {
  type: "string",
  title: "Text",
  description: "The generated text description",
} as const;

export const ImageToTextInputSchema = {
  type: "object",
  properties: {
    image: TypeReplicateArray(TypeImageInput),
    model: modelSchema,
    maxTokens: {
      type: "number",
      title: "Max Tokens",
      description: "The maximum number of tokens to generate",
      minimum: 1,
      maximum: 4096,
      "x-ui-group": "Configuration",
    },
  },
  required: ["image", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const ImageToTextOutputSchema = {
  type: "object",
  properties: {
    text: {
      oneOf: [generatedTextSchema, { type: "array", items: generatedTextSchema }],
      title: generatedTextSchema.title,
      description: generatedTextSchema.description,
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageToTextTaskInput = FromSchema<typeof ImageToTextInputSchema>;
export type ImageToTextTaskOutput = FromSchema<typeof ImageToTextOutputSchema>;
export type ImageToTextTaskExecuteInput = DeReplicateFromSchema<typeof ImageToTextInputSchema>;
export type ImageToTextTaskExecuteOutput = DeReplicateFromSchema<typeof ImageToTextOutputSchema>;

/**
 * Generates text descriptions from images using vision-language models
 */
export class ImageToTextTask extends AiVisionTask<
  ImageToTextTaskInput,
  ImageToTextTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "ImageToTextTask";
  public static category = "AI Vision Model";
  public static title = "Image to Text";
  public static description =
    "Generates text descriptions from images using vision-language models";
  public static inputSchema(): DataPortSchema {
    return ImageToTextInputSchema as DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return ImageToTextOutputSchema as DataPortSchema;
  }
}

TaskRegistry.registerTask(ImageToTextTask);

/**
 * Convenience function to run image to text tasks.
 * Creates and executes an ImageToTextTask with the provided input.
 * @param input The input parameters for image to text (image and model)
 * @returns Promise resolving to the generated text description
 */
export const imageToText = (input: ImageToTextTaskInput, config?: JobQueueTaskConfig) => {
  return new ImageToTextTask({} as ImageToTextTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    imageToText: CreateWorkflow<ImageToTextTaskInput, ImageToTextTaskOutput, JobQueueTaskConfig>;
  }
}

Workflow.prototype.imageToText = CreateWorkflow(ImageToTextTask);
