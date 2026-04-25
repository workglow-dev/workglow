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
import { PIXELATE_OP, ensureImageGpuApi } from "./imageOps";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
    blockSize: {
      type: "integer",
      title: "Block Size",
      description: "Size of each pixelation block",
      minimum: 2,
      default: 8,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Pixelated image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImagePixelateTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImagePixelateTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImagePixelateTask<
  Input extends ImagePixelateTaskInput = ImagePixelateTaskInput,
  Output extends ImagePixelateTaskOutput = ImagePixelateTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends ImageTaskBase<Input, Output, Config> {
  static override readonly type = "ImagePixelateTask";
  static override readonly category = "Image";
  public static override title = "Pixelate Image";
  public static override description = "Pixelates an image by averaging blocks of pixels";

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
    const blockSize = input.blockSize ?? 8;
    const image = await runImageOp(input.image, PIXELATE_OP, { blockSize });
    return { image: image as unknown as Output["image"] } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imagePixelate: CreateWorkflow<ImagePixelateTaskInput, ImagePixelateTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imagePixelate = CreateWorkflow(ImagePixelateTask);
