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
import { ColorSchema, ImageBinarySchema, ImageFromSchema } from "./ImageSchemas";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinarySchema({ title: "Image", description: "Source image" }),
    color: ColorSchema({ title: "Color", description: "Tint color" }),
    amount: {
      type: "number",
      title: "Amount",
      description: "Tint strength (0.0 = no tint, 1.0 = full tint color)",
      minimum: 0,
      maximum: 1,
      default: 0.5,
    },
  },
  required: ["image", "color"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinarySchema({ title: "Image", description: "Tinted image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageTintTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageTintTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageTintTask<
  Input extends ImageTintTaskInput = ImageTintTaskInput,
  Output extends ImageTintTaskOutput = ImageTintTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "ImageTintTask";
  static override readonly category = "Image";
  public static override title = "Tint Image";
  public static override description = "Applies a color tint to an image";

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
    const { r: tr, g: tg, b: tb } = input.color;
    const amount = input.amount ?? 0.5;
    const invAmount = 1 - amount;

    // Precompute tint contribution
    const tintR = tr * amount;
    const tintG = tg * amount;
    const tintB = tb * amount;

    const pixelCount = width * height;

    // 1-channel (grayscale) input: expand to 3-channel RGB output to apply full color tint
    if (channels === 1) {
      const dst = new Uint8ClampedArray(pixelCount * 3);
      for (let i = 0; i < pixelCount; i++) {
        const gray = src[i];
        dst[i * 3] = gray * invAmount + tintR;
        dst[i * 3 + 1] = gray * invAmount + tintG;
        dst[i * 3 + 2] = gray * invAmount + tintB;
      }
      return { image: { data: dst, width, height, channels: 3 } } as Output;
    }

    const dst = new Uint8ClampedArray(src.length);

    for (let i = 0; i < pixelCount; i++) {
      const idx = i * channels;
      dst[idx] = src[idx] * invAmount + tintR;
      dst[idx + 1] = src[idx + 1] * invAmount + tintG;
      dst[idx + 2] = src[idx + 2] * invAmount + tintB;
      if (channels === 4) {
        dst[idx + 3] = src[idx + 3]; // preserve alpha
      }
    }

    return { image: { data: dst, width, height, channels } } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageTint: CreateWorkflow<ImageTintTaskInput, ImageTintTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageTint = CreateWorkflow(ImageTintTask);
