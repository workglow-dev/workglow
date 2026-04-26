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
      description: "Brightness adjustment (-255 to 255)",
      minimum: -255,
      maximum: 255,
      default: 0,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Brightness-adjusted image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageBrightnessTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageBrightnessTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageBrightnessTask<
  Input extends ImageBrightnessTaskInput = ImageBrightnessTaskInput,
  Output extends ImageBrightnessTaskOutput = ImageBrightnessTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "ImageBrightnessTask";
  static override readonly category = "Image";
  public static override title = "Adjust Brightness";
  public static override description = "Adjusts the brightness of an image";

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
      const dst = new Uint8ClampedArray(src.length);

      if (channels === 4) {
        for (let i = 0; i < src.length; i += 4) {
          dst[i] = src[i]! + amount;
          dst[i + 1] = src[i + 1]! + amount;
          dst[i + 2] = src[i + 2]! + amount;
          dst[i + 3] = src[i + 3]!; // preserve alpha
        }
      } else {
        for (let i = 0; i < src.length; i++) {
          dst[i] = src[i]! + amount;
        }
      }

      return { data: dst, width, height, channels };
    });
    return { image } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageBrightness: CreateWorkflow<
      ImageBrightnessTaskInput,
      ImageBrightnessTaskOutput,
      TaskConfig
    >;
  }
}

Workflow.prototype.imageBrightness = CreateWorkflow(ImageBrightnessTask);
