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
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinarySchema({ title: "Image", description: "Sepia-toned image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageSepiaTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageSepiaTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageSepiaTask<
  Input extends ImageSepiaTaskInput = ImageSepiaTaskInput,
  Output extends ImageSepiaTaskOutput = ImageSepiaTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "ImageSepiaTask";
  static override readonly category = "Image";
  public static override title = "Sepia Tone";
  public static override description = "Applies a sepia tone filter to an image";

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
    const { data: src, width, height, channels } = input.image;
    const dst = new Uint8ClampedArray(src.length);

    // Integer-approximated sepia coefficients (multiplied by 1024, shift by 10)
    // R: 0.393*R + 0.769*G + 0.189*B
    // G: 0.349*R + 0.686*G + 0.168*B
    // B: 0.272*R + 0.534*G + 0.131*B
    const pixelCount = width * height;

    for (let i = 0; i < pixelCount; i++) {
      const idx = i * channels;
      const r = channels === 1 ? src[idx] : src[idx];
      const g = channels === 1 ? src[idx] : src[idx + 1];
      const b = channels === 1 ? src[idx] : src[idx + 2];

      const outR = (r * 402 + g * 787 + b * 194) >> 10;
      const outG = (r * 357 + g * 702 + b * 172) >> 10;
      const outB = (r * 279 + g * 547 + b * 134) >> 10;

      dst[idx] = outR > 255 ? 255 : outR;
      if (channels >= 3) {
        dst[idx + 1] = outG > 255 ? 255 : outG;
        dst[idx + 2] = outB > 255 ? 255 : outB;
      }
      if (channels === 4) {
        dst[idx + 3] = src[idx + 3]; // preserve alpha
      }
    }

    return { image: { data: dst, width, height, channels } } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageSepia: CreateWorkflow<ImageSepiaTaskInput, ImageSepiaTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageSepia = CreateWorkflow(ImageSepiaTask);
