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
import { runImageResizeOp } from "./imageOpDispatcher";
import { CROP_OP } from "./imageOps";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
    x: { type: "integer", title: "X", description: "Left offset", minimum: 0 },
    y: { type: "integer", title: "Y", description: "Top offset", minimum: 0 },
    width: { type: "integer", title: "Width", description: "Crop width", minimum: 1 },
    height: { type: "integer", title: "Height", description: "Crop height", minimum: 1 },
  },
  required: ["image", "x", "y", "width", "height"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Cropped image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageCropTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageCropTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageCropTask<
  Input extends ImageCropTaskInput = ImageCropTaskInput,
  Output extends ImageCropTaskOutput = ImageCropTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends ImageTaskBase<Input, Output, Config> {
  static override readonly type = "ImageCropTask";
  static override readonly category = "Image";
  public static override title = "Crop Image";
  public static override description = "Crops an image to a rectangular region";

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
    const image = await runImageResizeOp(input.image, CROP_OP, {
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
    });
    return { image: image as unknown as Output["image"] } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageCrop: CreateWorkflow<ImageCropTaskInput, ImageCropTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageCrop = CreateWorkflow(ImageCropTask);
