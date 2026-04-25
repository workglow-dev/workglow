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
import { BLUR_OP, ensureImageGpuApi } from "./imageOps";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
    radius: {
      type: "integer",
      title: "Radius",
      description: "Blur radius (1-10)",
      minimum: 1,
      maximum: 10,
      default: 1,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Blurred image" }),
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
> extends ImageTaskBase<Input, Output, Config> {
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
    await ensureImageGpuApi();
    const radius = input.radius ?? 1;
    const image = await runImageOp(input.image, BLUR_OP, { radius });
    return { image: image as unknown as Output["image"] } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageBlur: CreateWorkflow<ImageBlurTaskInput, ImageBlurTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageBlur = CreateWorkflow(ImageBlurTask);
