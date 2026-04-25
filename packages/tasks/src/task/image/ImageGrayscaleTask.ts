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
import { GRAYSCALE_OP, ensureImageGpuApi } from "./imageOps";

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
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Grayscale image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageGrayscaleTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageGrayscaleTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageGrayscaleTask<
  Input extends ImageGrayscaleTaskInput = ImageGrayscaleTaskInput,
  Output extends ImageGrayscaleTaskOutput = ImageGrayscaleTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends ImageTaskBase<Input, Output, Config> {
  static override readonly type = "ImageGrayscaleTask";
  static override readonly category = "Image";
  public static override title = "Grayscale";
  public static override description = "Converts an image to grayscale using luminance";

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
    const image = await runImageOp(input.image, GRAYSCALE_OP, undefined);
    return { image: image as unknown as Output["image"] } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageGrayscale: CreateWorkflow<ImageGrayscaleTaskInput, ImageGrayscaleTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageGrayscale = CreateWorkflow(ImageGrayscaleTask);
