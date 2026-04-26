/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecutePreviewContext,
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
    amount: {
      type: "number",
      title: "Amount",
      description: "Contrast adjustment (-100 to 100)",
      minimum: -100,
      maximum: 100,
      default: 0,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Contrast-adjusted image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageContrastTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageContrastTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageContrastTask<
  Input extends ImageContrastTaskInput = ImageContrastTaskInput,
  Output extends ImageContrastTaskOutput = ImageContrastTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "ImageContrastTask";
  static override readonly category = "Image";
  public static override title = "Adjust Contrast";
  public static override description = "Adjusts the contrast of an image";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    const amount = input.amount ?? 0;
    const image = await produceImageOutput(input.image, (img) => {
      const { data: src, width, height, channels } = img;

      // Precompute 256-entry lookup table
      const factor = (259 * (amount + 255)) / (255 * (259 - amount));
      const lut = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) {
        lut[i] = factor * (i - 128) + 128;
      }

      const dst = new Uint8ClampedArray(src.length);

      if (channels === 4) {
        for (let i = 0; i < src.length; i += 4) {
          dst[i] = lut[src[i]!]!;
          dst[i + 1] = lut[src[i + 1]!]!;
          dst[i + 2] = lut[src[i + 2]!]!;
          dst[i + 3] = src[i + 3]!; // preserve alpha
        }
      } else {
        for (let i = 0; i < src.length; i++) {
          dst[i] = lut[src[i]!]!;
        }
      }

      return { data: dst, width, height, channels };
    });
    return { image } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageContrast: CreateWorkflow<ImageContrastTaskInput, ImageContrastTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageContrast = CreateWorkflow(ImageContrastTask);
