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

async function applyGrayscale(input: ImageGrayscaleTaskInput): Promise<ImageGrayscaleTaskOutput> {
  const image = await produceImageOutput(input.image, (img) => {
    const { data: src, width, height, channels } = img;

    if (channels === 1) {
      return { data: new Uint8ClampedArray(src), width, height, channels: 1 };
    }

    const pixelCount = width * height;
    const dst = new Uint8ClampedArray(pixelCount);

    for (let i = 0; i < pixelCount; i++) {
      const idx = i * channels;
      dst[i] = (src[idx] * 77 + src[idx + 1] * 150 + src[idx + 2] * 29) >> 8;
    }

    return { data: dst, width, height, channels: 1 };
  });
  return { image };
}

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Grayscale image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageGrayscaleTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageGrayscaleTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageGrayscaleTask<
  Input extends ImageGrayscaleTaskInput = ImageGrayscaleTaskInput,
  Output extends ImageGrayscaleTaskOutput = ImageGrayscaleTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "ImageGrayscaleTask";
  static override readonly category = "Image";
  public static override title = "Grayscale";
  public static override description = "Converts an image to grayscale using luminance";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(input: Input, _context: IExecuteContext): Promise<Output | undefined> {
    return (await applyGrayscale(input)) as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return (await applyGrayscale(input)) as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageGrayscale: CreateWorkflow<ImageGrayscaleTaskInput, ImageGrayscaleTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageGrayscale = CreateWorkflow(ImageGrayscaleTask);
