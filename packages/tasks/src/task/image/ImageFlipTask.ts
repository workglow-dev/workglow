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

async function flipImage(input: ImageFlipTaskInput): Promise<ImageFlipTaskOutput> {
  const { direction } = input;
  const image = await produceImageOutput(input.image, (img) => {
    const { data: src, width, height, channels } = img;
    const dst = new Uint8ClampedArray(src.length);
    const rowBytes = width * channels;

    if (direction === "vertical") {
      for (let y = 0; y < height; y++) {
        const srcOffset = y * rowBytes;
        const dstOffset = (height - 1 - y) * rowBytes;
        dst.set(src.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
      }
    } else {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const srcIdx = (y * width + x) * channels;
          const dstIdx = (y * width + (width - 1 - x)) * channels;
          for (let c = 0; c < channels; c++) {
            dst[dstIdx + c] = src[srcIdx + c];
          }
        }
      }
    }

    return { data: dst, width, height, channels };
  });
  return { image };
}

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
    direction: {
      type: "string",
      enum: ["horizontal", "vertical"],
      title: "Direction",
      description: "Flip direction",
    },
  },
  required: ["image", "direction"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Flipped image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageFlipTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageFlipTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageFlipTask<
  Input extends ImageFlipTaskInput = ImageFlipTaskInput,
  Output extends ImageFlipTaskOutput = ImageFlipTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "ImageFlipTask";
  static override readonly category = "Image";
  public static override title = "Flip Image";
  public static override description = "Flips an image horizontally or vertically";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(
    input: Input,
    _context: IExecuteContext
  ): Promise<Output | undefined> {
    return (await flipImage(input)) as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return (await flipImage(input)) as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageFlip: CreateWorkflow<ImageFlipTaskInput, ImageFlipTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageFlip = CreateWorkflow(ImageFlipTask);
