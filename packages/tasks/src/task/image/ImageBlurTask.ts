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
    radius: {
      type: "integer",
      title: "Radius",
      description: "Blur radius (1-10)",
      minimum: 1,
      maximum: 10,
      default: 1,
    },
  },
  required: ["image", "radius"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinarySchema({ title: "Image", description: "Blurred image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageBlurTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageBlurTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageBlurTask<
  Input extends ImageBlurTaskInput = ImageBlurTaskInput,
  Output extends ImageBlurTaskOutput = ImageBlurTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "ImageBlurTask";
  static override readonly category = "Image";
  public static override title = "Blur Image";
  public static override description = "Applies a box blur to an image";

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
    const { image, radius } = input;
    const { data: src, width, height, channels } = image;
    const kernelSize = radius * 2 + 1;

    // Horizontal pass
    const tmp = new Uint8ClampedArray(src.length);
    for (let y = 0; y < height; y++) {
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        // Initialize running sum for first pixel
        for (let k = -radius; k <= radius; k++) {
          const x = Math.max(0, Math.min(k, width - 1));
          sum += src[(y * width + x) * channels + c];
        }
        tmp[y * width * channels + c] = (sum / kernelSize + 0.5) | 0;

        // Slide the window across the row
        for (let x = 1; x < width; x++) {
          const addX = Math.min(x + radius, width - 1);
          const removeX = Math.max(x - radius - 1, 0);
          sum += src[(y * width + addX) * channels + c] - src[(y * width + removeX) * channels + c];
          tmp[(y * width + x) * channels + c] = (sum / kernelSize + 0.5) | 0;
        }
      }
    }

    // Vertical pass
    const dst = new Uint8ClampedArray(src.length);
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const y = Math.max(0, Math.min(k, height - 1));
          sum += tmp[(y * width + x) * channels + c];
        }
        dst[x * channels + c] = (sum / kernelSize + 0.5) | 0;

        for (let y = 1; y < height; y++) {
          const addY = Math.min(y + radius, height - 1);
          const removeY = Math.max(y - radius - 1, 0);
          sum +=
            tmp[(addY * width + x) * channels + c] - tmp[(removeY * width + x) * channels + c];
          dst[(y * width + x) * channels + c] = (sum / kernelSize + 0.5) | 0;
        }
      }
    }

    return { image: { data: dst, width, height, channels } } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageBlur: CreateWorkflow<ImageBlurTaskInput, ImageBlurTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageBlur = CreateWorkflow(ImageBlurTask);
