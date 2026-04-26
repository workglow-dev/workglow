/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecuteContext,
  IExecutePreviewContext,
  Task,
  TaskConfig,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util/schema";
import { ImageBinaryOrDataUriSchema, ImageFromSchema } from "./ImageSchemas";
import { produceImageOutput } from "./imageTaskIo";

async function cropImage(input: ImageCropTaskInput): Promise<ImageCropTaskOutput> {
  const { x: rawX, y: rawY, width: rawW, height: rawH } = input;
  const image = await produceImageOutput(input.image, (img) => {
    const { data: src, width: srcW, height: srcH, channels } = img;

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

    return { data: dst, width: w, height: h, channels };
  });
  return { image };
}

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

  override async execute(input: Input, _context: IExecuteContext): Promise<Output | undefined> {
    return (await cropImage(input)) as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return (await cropImage(input)) as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageCrop: CreateWorkflow<ImageCropTaskInput, ImageCropTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageCrop = CreateWorkflow(ImageCropTask);
