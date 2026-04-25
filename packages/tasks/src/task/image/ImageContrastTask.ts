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
import { CONTRAST_OP, ensureImageGpuApi } from "./imageOps";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
    amount: {
      type: "number",
      title: "Amount",
      description: "Contrast adjustment (-100 to 100)",
      minimum: -100,
      maximum: 100,
      default: 0,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Contrast-adjusted image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageContrastTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageContrastTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageContrastTask<
  Input extends ImageContrastTaskInput = ImageContrastTaskInput,
  Output extends ImageContrastTaskOutput = ImageContrastTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends ImageTaskBase<Input, Output, Config> {
  static override readonly type = "ImageContrastTask";
  static override readonly category = "Image";
  public static override title = "Adjust Contrast";
  public static override description = "Adjusts the contrast of an image";

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
    const amount = input.amount ?? 0;
    const image = await runImageOp(input.image, CONTRAST_OP, { amount });
    return { image: image as unknown as Output["image"] } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageContrast: CreateWorkflow<ImageContrastTaskInput, ImageContrastTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageContrast = CreateWorkflow(ImageContrastTask);
