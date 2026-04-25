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
import { runImageResizeOp } from "./imageOpDispatcher";
import { ROTATE_OP } from "./imageOps";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
    angle: {
      type: "integer",
      enum: [90, 180, 270],
      title: "Angle",
      description: "Rotation angle in degrees (clockwise)",
    },
  },
  required: ["image", "angle"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Rotated image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageRotateTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageRotateTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageRotateTask<
  Input extends ImageRotateTaskInput = ImageRotateTaskInput,
  Output extends ImageRotateTaskOutput = ImageRotateTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends ImageTaskBase<Input, Output, Config> {
  static override readonly type = "ImageRotateTask";
  static override readonly category = "Image";
  public static override title = "Rotate Image";
  public static override description = "Rotates an image by 90, 180, or 270 degrees clockwise";

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
    const image = await runImageResizeOp(input.image, ROTATE_OP, {
      angle: input.angle as 90 | 180 | 270,
    });
    return { image: image as unknown as Output["image"] } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageRotate: CreateWorkflow<ImageRotateTaskInput, ImageRotateTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageRotate = CreateWorkflow(ImageRotateTask);
