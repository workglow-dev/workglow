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
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Inverted image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageInvertTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageInvertTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageInvertTask<
  Input extends ImageInvertTaskInput = ImageInvertTaskInput,
  Output extends ImageInvertTaskOutput = ImageInvertTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "ImageInvertTask";
  static override readonly category = "Image";
  public static override title = "Invert Colors";
  public static override description = "Inverts the colors of an image";

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
    const image = await produceImageOutput(input.image, (img) => {
      const { data: src, width, height, channels } = img;
      const dst = new Uint8ClampedArray(src.length);

      if (channels === 4) {
        for (let i = 0; i < src.length; i += 4) {
          dst[i] = 255 - src[i]!;
          dst[i + 1] = 255 - src[i + 1]!;
          dst[i + 2] = 255 - src[i + 2]!;
          dst[i + 3] = src[i + 3]!; // preserve alpha
        }
      } else {
        for (let i = 0; i < src.length; i++) {
          dst[i] = 255 - src[i]!;
        }
      }

      return { data: dst, width, height, channels };
    });
    return { image } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageInvert: CreateWorkflow<ImageInvertTaskInput, ImageInvertTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageInvert = CreateWorkflow(ImageInvertTask);
