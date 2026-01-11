/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateWorkflow, JobQueueTaskConfig, Workflow } from "@workglow/task-graph";
import {
  DataPortSchema,
  FromSchema,
  TypedArraySchema,
  TypedArraySchemaOptions,
} from "@workglow/util";
import { TypeImageInput, TypeModel } from "./base/AiTaskSchemas";
import { AiVisionTask } from "./base/AiVisionTask";

const modelSchema = TypeModel("model:ImageEmbeddingTask");

const embeddingSchema = TypedArraySchema({
  title: "Embedding",
  description: "The image embedding vector",
});

export const ImageEmbeddingInputSchema = {
  type: "object",
  properties: {
    image: TypeImageInput,
    model: modelSchema,
  },
  required: ["image", "model"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const ImageEmbeddingOutputSchema = {
  type: "object",
  properties: {
    vector: embeddingSchema,
  },
  required: ["vector"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageEmbeddingTaskInput = FromSchema<
  typeof ImageEmbeddingInputSchema,
  TypedArraySchemaOptions
>;
export type ImageEmbeddingTaskOutput = FromSchema<
  typeof ImageEmbeddingOutputSchema,
  TypedArraySchemaOptions
>;

/**
 * Generates embeddings from images using vision models
 */
export class ImageEmbeddingTask extends AiVisionTask<
  ImageEmbeddingTaskInput,
  ImageEmbeddingTaskOutput,
  JobQueueTaskConfig
> {
  public static type = "ImageEmbeddingTask";
  public static category = "AI Vision Model";
  public static title = "Image Embedding";
  public static description = "Generates embeddings from images using vision models";
  public static inputSchema(): DataPortSchema {
    return ImageEmbeddingInputSchema as DataPortSchema;
  }
  public static outputSchema(): DataPortSchema {
    return ImageEmbeddingOutputSchema as DataPortSchema;
  }
}

/**
 * Convenience function to run image embedding tasks.
 * Creates and executes an ImageEmbeddingTask with the provided input.
 * @param input The input parameters for image embedding (image and model)
 * @returns Promise resolving to the image embedding vector
 */
export const imageEmbedding = (input: ImageEmbeddingTaskInput, config?: JobQueueTaskConfig) => {
  return new ImageEmbeddingTask({} as ImageEmbeddingTaskInput, config).run(input);
};

declare module "@workglow/task-graph" {
  interface Workflow {
    imageEmbedding: CreateWorkflow<
      ImageEmbeddingTaskInput,
      ImageEmbeddingTaskOutput,
      JobQueueTaskConfig
    >;
  }
}

Workflow.prototype.imageEmbedding = CreateWorkflow(ImageEmbeddingTask);
