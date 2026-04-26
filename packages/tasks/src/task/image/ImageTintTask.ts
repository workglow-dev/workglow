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
import { ColorValueSchema, ImageBinaryOrDataUriSchema, ImageFromSchema } from "./ImageSchemas";
import { resolveColor } from "@workglow/util/media";
import { produceImageOutput } from "./imageTaskIo";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
    color: ColorValueSchema({ title: "Color", description: "Tint color" }),
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
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Tinted image" }),
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

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    const { r: tr, g: tg, b: tb } = resolveColor(input.color);
    const amount = input.amount ?? 0.5;
    const invAmount = 1 - amount;
    const tintR = tr * amount;
    const tintG = tg * amount;
    const tintB = tb * amount;

    const image = await produceImageOutput(input.image, (img) => {
      const { data: src, width, height, channels } = img;
      const pixelCount = width * height;

      if (channels === 1) {
        const dst = new Uint8ClampedArray(pixelCount * 3);
        for (let i = 0; i < pixelCount; i++) {
          const gray = src[i]!;
          dst[i * 3] = gray * invAmount + tintR;
          dst[i * 3 + 1] = gray * invAmount + tintG;
          dst[i * 3 + 2] = gray * invAmount + tintB;
        }
        return { data: dst, width, height, channels: 3 };
      }

      const dst = new Uint8ClampedArray(src.length);

      for (let i = 0; i < pixelCount; i++) {
        const idx = i * channels;
        dst[idx] = src[idx]! * invAmount + tintR;
        dst[idx + 1] = src[idx + 1]! * invAmount + tintG;
        dst[idx + 2] = src[idx + 2]! * invAmount + tintB;
        if (channels === 4) {
          dst[idx + 3] = src[idx + 3]!; // preserve alpha
        }
      }

      return { data: dst, width, height, channels };
    });
    return { image } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageTint: CreateWorkflow<ImageTintTaskInput, ImageTintTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageTint = CreateWorkflow(ImageTintTask);
