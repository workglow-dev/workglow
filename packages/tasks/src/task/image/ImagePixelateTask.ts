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

async function pixelateImage(input: ImagePixelateTaskInput): Promise<ImagePixelateTaskOutput> {
  const { blockSize = 8 } = input;
  const image = await produceImageOutput(input.image, (img) => {
    const { data: src, width, height, channels } = img;
    const dst = new Uint8ClampedArray(src.length);

    for (let by = 0; by < height; by += blockSize) {
      const blockH = Math.min(blockSize, height - by);
      for (let bx = 0; bx < width; bx += blockSize) {
        const blockW = Math.min(blockSize, width - bx);
        const blockArea = blockW * blockH;

        // Compute average color of the block
        const sums = new Array<number>(channels).fill(0);
        for (let y = by; y < by + blockH; y++) {
          for (let x = bx; x < bx + blockW; x++) {
            const idx = (y * width + x) * channels;
            for (let c = 0; c < channels; c++) {
              sums[c] += src[idx + c];
            }
          }
        }

        const avg = sums.map((s) => (s / blockArea + 0.5) | 0);

        // Fill the block with the average color
        for (let y = by; y < by + blockH; y++) {
          for (let x = bx; x < bx + blockW; x++) {
            const idx = (y * width + x) * channels;
            for (let c = 0; c < channels; c++) {
              dst[idx + c] = avg[c]!;
            }
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
    blockSize: {
      type: "integer",
      title: "Block Size",
      description: "Size of each pixelation block",
      minimum: 2,
      default: 8,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Pixelated image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImagePixelateTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImagePixelateTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImagePixelateTask<
  Input extends ImagePixelateTaskInput = ImagePixelateTaskInput,
  Output extends ImagePixelateTaskOutput = ImagePixelateTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "ImagePixelateTask";
  static override readonly category = "Image";
  public static override title = "Pixelate Image";
  public static override description = "Pixelates an image by averaging blocks of pixels";

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
    return (await pixelateImage(input)) as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return (await pixelateImage(input)) as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imagePixelate: CreateWorkflow<ImagePixelateTaskInput, ImagePixelateTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imagePixelate = CreateWorkflow(ImagePixelateTask);
