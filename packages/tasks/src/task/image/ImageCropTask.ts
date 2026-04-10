/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecuteReactiveContext,
  Task,
  TaskConfig,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util/schema";
import { ImageBinarySchema, ImageFromSchema } from "./ImageSchemas";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinarySchema({ title: "Image", description: "Source image" }),
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
    image: ImageBinarySchema({ title: "Image", description: "Cropped image" }),
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
> extends Task<Input, Output, Config> {
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
    const { image, x: rawX, y: rawY, width: rawW, height: rawH } = input;
    const { data: src, width: srcW, height: srcH, channels } = image;

    if (srcW < 1 || srcH < 1) {
      throw new RangeError("Cannot crop an empty image");
    }

    if (rawX < 0 || rawX >= srcW || rawY < 0 || rawY >= srcH) {
      throw new RangeError("Crop origin is outside the source image bounds");
    }

    const x = rawX;
    const y = rawY;
    const w = Math.min(rawW, srcW - x);
    const h = Math.min(rawH, srcH - y);

    const dst = new Uint8ClampedArray(w * h * channels);
    const rowBytes = w * channels;

    for (let row = 0; row < h; row++) {
      const srcOffset = ((y + row) * srcW + x) * channels;
      const dstOffset = row * rowBytes;
      dst.set(src.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
    }

    return { image: { data: dst, width: w, height: h, channels } } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageCrop: CreateWorkflow<ImageCropTaskInput, ImageCropTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageCrop = CreateWorkflow(ImageCropTask);
