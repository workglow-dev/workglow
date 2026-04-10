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
> extends Task<Input, Output, Config> {
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
    const levels = input.levels ?? 4;
    const image = await produceImageOutput(input.image, (img) => {
      const { data: src, width, height, channels } = img;

      // Precompute 256-entry lookup table
      const step = 255 / (levels - 1);
      const lut = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) {
        lut[i] = Math.round(Math.round(i / step) * step);
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
    imagePosterize: CreateWorkflow<ImagePosterizeTaskInput, ImagePosterizeTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imagePosterize = CreateWorkflow(ImagePosterizeTask);
