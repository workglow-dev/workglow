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
    angle: {
      type: "integer",
      enum: [90, 180, 270],
      title: "Angle",
      description: "Rotation angle in degrees (clockwise)",
    },
  },
  required: ["image", "angle"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Rotated image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageRotateTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageRotateTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageRotateTask<
  Input extends ImageRotateTaskInput = ImageRotateTaskInput,
  Output extends ImageRotateTaskOutput = ImageRotateTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "ImageRotateTask";
  static override readonly category = "Image";
  public static override title = "Rotate Image";
  public static override description = "Rotates an image by 90, 180, or 270 degrees clockwise";

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
    const { angle } = input;
    const image = await produceImageOutput(input.image, (img) => {
      const { data: src, width: srcW, height: srcH, channels } = img;

      const swap = angle === 90 || angle === 270;
      const dstW = swap ? srcH : srcW;
      const dstH = swap ? srcW : srcH;
      const dst = new Uint8ClampedArray(dstW * dstH * channels);

      for (let sy = 0; sy < srcH; sy++) {
        for (let sx = 0; sx < srcW; sx++) {
          let dx: number, dy: number;
          if (angle === 90) {
            dx = srcH - 1 - sy;
            dy = sx;
          } else if (angle === 180) {
            dx = srcW - 1 - sx;
            dy = srcH - 1 - sy;
          } else {
            dx = sy;
            dy = srcW - 1 - sx;
          }
          const srcIdx = (sy * srcW + sx) * channels;
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
    imageRotate: CreateWorkflow<ImageRotateTaskInput, ImageRotateTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageRotate = CreateWorkflow(ImageRotateTask);
