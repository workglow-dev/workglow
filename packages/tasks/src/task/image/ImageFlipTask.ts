/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecuteReactiveContext,
  TaskConfig,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util/schema";
import { ImageBinaryOrDataUriSchema, ImageFromSchema } from "./ImageSchemas";
import { ImageTaskBase } from "./ImageTaskBase";
import { runImageOp } from "./imageOpDispatcher";
import { FLIP_OP, ensureImageGpuApi } from "./imageOps";

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
> extends ImageTaskBase<Input, Output, Config> {
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

  override async executeReactive(
    input: Input,
    _output: Output,
    _context: IExecuteReactiveContext
  ): Promise<Output> {
    await ensureImageGpuApi();
    const image = await runImageOp(input.image, FLIP_OP, { direction: input.direction });
    return { image: image as unknown as Output["image"] } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageFlip: CreateWorkflow<ImageFlipTaskInput, ImageFlipTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageFlip = CreateWorkflow(ImageFlipTask);
