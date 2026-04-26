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

async function applyThreshold(input: ImageThresholdTaskInput): Promise<ImageThresholdTaskOutput> {
  const threshold = input.threshold ?? 128;
  const image = await produceImageOutput(input.image, (img) => {
    const { data: src, width, height, channels } = img;
    const pixelCount = width * height;
    const dst = new Uint8ClampedArray(pixelCount);

    for (let i = 0; i < pixelCount; i++) {
      const idx = i * channels;
      let gray: number;
      if (channels === 1) {
        gray = src[idx]!;
      } else {
        gray = (src[idx]! * 77 + src[idx + 1]! * 150 + src[idx + 2]! * 29) >> 8;
      }
      dst[i] = gray >= threshold ? 255 : 0;
    }

    return { data: dst, width, height, channels: 1 };
  });
  return { image };
}

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
    threshold: {
      type: "integer",
      title: "Threshold",
      description: "Threshold value (0-255)",
      minimum: 0,
      maximum: 255,
      default: 128,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Thresholded binary image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageThresholdTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageThresholdTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageThresholdTask<
  Input extends ImageThresholdTaskInput = ImageThresholdTaskInput,
  Output extends ImageThresholdTaskOutput = ImageThresholdTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "ImageThresholdTask";
  static override readonly category = "Image";
  public static override title = "Threshold";
  public static override description = "Converts an image to binary black and white";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override async execute(input: Input, _context: IExecuteContext): Promise<Output | undefined> {
    return (await applyThreshold(input)) as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return (await applyThreshold(input)) as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageThreshold: CreateWorkflow<ImageThresholdTaskInput, ImageThresholdTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageThreshold = CreateWorkflow(ImageThresholdTask);
