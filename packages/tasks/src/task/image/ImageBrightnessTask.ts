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
import { BRIGHTNESS_OP, ensureImageGpuApi } from "./imageOps";

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
> extends ImageTaskBase<Input, Output, Config> {
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

  override async executeReactive(
    input: Input,
    _output: Output,
    _context: IExecuteReactiveContext
  ): Promise<Output> {
    await ensureImageGpuApi();
    const amount = input.amount ?? 0;
    const image = await runImageOp(input.image, BRIGHTNESS_OP, { amount });
    return { image: image as unknown as Output["image"] } as Output;
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
