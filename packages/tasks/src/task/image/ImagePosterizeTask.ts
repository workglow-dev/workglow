/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecuteReactiveContext,
  TaskConfig,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util/schema";
import { ImageBinaryOrDataUriSchema, ImageFromSchema } from "./ImageSchemas";
import { ImageTaskBase } from "./ImageTaskBase";
import { runImageOp } from "./imageOpDispatcher";
import { POSTERIZE_OP, ensureImageGpuApi } from "./imageOps";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
    levels: {
      type: "integer",
      title: "Levels",
      description: "Number of color levels per channel (2-32)",
      minimum: 2,
      maximum: 32,
      default: 4,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Posterized image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImagePosterizeTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImagePosterizeTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImagePosterizeTask<
  Input extends ImagePosterizeTaskInput = ImagePosterizeTaskInput,
  Output extends ImagePosterizeTaskOutput = ImagePosterizeTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends ImageTaskBase<Input, Output, Config> {
  static override readonly type = "ImagePosterizeTask";
  static override readonly category = "Image";
  public static override title = "Posterize";
  public static override description = "Reduces the number of color levels in an image";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async executeReactive(
    input: Input,
    _output: Output,
    _context: IExecuteReactiveContext
  ): Promise<Output> {
    await ensureImageGpuApi();
    const levels = input.levels ?? 4;
    const image = await runImageOp(input.image, POSTERIZE_OP, { levels });
    return { image: image as unknown as Output["image"] } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imagePosterize: CreateWorkflow<ImagePosterizeTaskInput, ImagePosterizeTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imagePosterize = CreateWorkflow(ImagePosterizeTask);
