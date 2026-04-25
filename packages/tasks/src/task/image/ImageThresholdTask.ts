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
import { THRESHOLD_OP, ensureImageGpuApi } from "./imageOps";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
    threshold: {
      type: "integer",
      title: "Threshold",
      description: "Threshold value (0-255)",
      minimum: 0,
      maximum: 255,
      default: 128,
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Thresholded binary image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageThresholdTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageThresholdTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageThresholdTask<
  Input extends ImageThresholdTaskInput = ImageThresholdTaskInput,
  Output extends ImageThresholdTaskOutput = ImageThresholdTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends ImageTaskBase<Input, Output, Config> {
  static override readonly type = "ImageThresholdTask";
  static override readonly category = "Image";
  public static override title = "Threshold";
  public static override description = "Converts an image to binary black and white";

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
    const threshold = input.threshold ?? 128;
    const image = await runImageOp(input.image, THRESHOLD_OP, { threshold });
    return { image: image as unknown as Output["image"] } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageThreshold: CreateWorkflow<ImageThresholdTaskInput, ImageThresholdTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageThreshold = CreateWorkflow(ImageThresholdTask);
