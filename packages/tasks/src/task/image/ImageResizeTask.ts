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
import { RESIZE_OP } from "./imageOps";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
    width: { type: "integer", title: "Width", description: "Target width in pixels", minimum: 1 },
    height: {
      type: "integer",
      title: "Height",
      description: "Target height in pixels",
      minimum: 1,
    },
  },
  required: ["image", "width", "height"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Resized image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageResizeTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageResizeTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageResizeTask<
  Input extends ImageResizeTaskInput = ImageResizeTaskInput,
  Output extends ImageResizeTaskOutput = ImageResizeTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends ImageTaskBase<Input, Output, Config> {
  static override readonly type = "ImageResizeTask";
  static override readonly category = "Image";
  public static override title = "Resize Image";
  public static override description = "Resizes an image using nearest-neighbor sampling";

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
    const image = await runImageResizeOp(input.image, RESIZE_OP, {
      width: input.width,
      height: input.height,
    });
    return { image: image as unknown as Output["image"] } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageResize: CreateWorkflow<ImageResizeTaskInput, ImageResizeTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageResize = CreateWorkflow(ImageResizeTask);
