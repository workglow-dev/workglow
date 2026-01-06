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

const modelSchema = TypeReplicateArray(TypeModel("model:BackgroundRemovalTask"));

const processedImageSchema = {
  type: "string",
  contentEncoding: "base64",
  contentMediaType: "image/png",
  title: "Image",
  description: "Base64-encoded PNG image with transparent background",
} as const;

export const BackgroundRemovalInputSchema = {
  type: "object",
  properties: {
    image: TypeReplicateArray(TypeImageInput),
    model: modelSchema,
  },
  required: ["image", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const BackgroundRemovalOutputSchema = {
  type: "object",
  properties: {
    image: {
      oneOf: [processedImageSchema, { type: "array", items: processedImageSchema }],
      title: processedImageSchema.title,
      description: processedImageSchema.description,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type BackgroundRemovalTaskInput = FromSchema<typeof BackgroundRemovalInputSchema>;
export type BackgroundRemovalTaskOutput = FromSchema<typeof BackgroundRemovalOutputSchema>;
export type BackgroundRemovalTaskExecuteInput = DeReplicateFromSchema<
  typeof BackgroundRemovalInputSchema
>;
export type BackgroundRemovalTaskExecuteOutput = DeReplicateFromSchema<
  typeof BackgroundRemovalOutputSchema
>;

/**
 * Removes backgrounds from images using computer vision models
 */
export class BackgroundRemovalTask extends AiVisionTask<
  BackgroundRemovalTaskInput,
  BackgroundRemovalTaskOutput
> {
  public static type = "BackgroundRemovalTask";
  public static category = "AI Vision Model";
  public static title = "Background Removal";
  public static description =
    "Removes backgrounds from images, producing images with transparent backgrounds";
  public static inputSchema(): DataPortSchema {
    return BackgroundRemovalInputSchema as DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return BackgroundRemovalOutputSchema as DataPortSchema;
  }
}

TaskRegistry.registerTask(BackgroundRemovalTask);

/**
 * Convenience function to run background removal tasks.
 * Creates and executes a BackgroundRemovalTask with the provided input.
 * @param input The input parameters for background removal (image and model)
 * @returns Promise resolving to the image with transparent background
 */
export const backgroundRemoval = (
  input: BackgroundRemovalTaskInput,
  config?: JobQueueTaskConfig
) => {
  return new BackgroundRemovalTask({} as BackgroundRemovalTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    backgroundRemoval: CreateWorkflow<
      BackgroundRemovalTaskInput,
      BackgroundRemovalTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.backgroundRemoval = CreateWorkflow(BackgroundRemovalTask);
