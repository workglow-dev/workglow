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
import { ImageBinaryOrDataUriSchema, ImageFromSchema } from "./ImageSchemas";
import { produceImageOutput } from "./imageTaskIo";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
    width: { type: "integer", title: "Width", description: "Target width in pixels", minimum: 1 },
    height: {
      type: "integer",
      title: "Height",
      description: "Target height in pixels",
      minimum: 1,
    },
  },
  required: ["image", "width", "height"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Resized image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageResizeTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageResizeTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageResizeTask<
  Input extends ImageResizeTaskInput = ImageResizeTaskInput,
  Output extends ImageResizeTaskOutput = ImageResizeTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "ImageResizeTask";
  static override readonly category = "Image";
  public static override title = "Resize Image";
  public static override description = "Resizes an image using nearest-neighbor sampling";

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
    const { width: dstW, height: dstH } = input;
    const image = await produceImageOutput(input.image, (img) => {
      const { data: src, width: srcW, height: srcH, channels } = img;
      const dst = new Uint8ClampedArray(dstW * dstH * channels);

      for (let dy = 0; dy < dstH; dy++) {
        const srcY = Math.min(Math.floor((dy * srcH) / dstH), srcH - 1);
        for (let dx = 0; dx < dstW; dx++) {
          const srcX = Math.min(Math.floor((dx * srcW) / dstW), srcW - 1);
          const srcIdx = (srcY * srcW + srcX) * channels;
          const dstIdx = (dy * dstW + dx) * channels;
          for (let c = 0; c < channels; c++) {
            dst[dstIdx + c] = src[srcIdx + c];
          }
        }
      }

      return { data: dst, width: dstW, height: dstH, channels };
    });
    return { image } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageResize: CreateWorkflow<ImageResizeTaskInput, ImageResizeTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageResize = CreateWorkflow(ImageResizeTask);
