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
import { TRANSPARENCY_OP, ensureImageGpuApi } from "./imageOps";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
    opacity: {
      type: "number",
      title: "Opacity",
      description: "Opacity level (0.0 = fully transparent, 1.0 = fully opaque)",
      minimum: 0,
      maximum: 1,
    },
  },
  required: ["image", "opacity"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({
      title: "Image",
      description: "Image with adjusted transparency",
    }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageTransparencyTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageTransparencyTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageTransparencyTask<
  Input extends ImageTransparencyTaskInput = ImageTransparencyTaskInput,
  Output extends ImageTransparencyTaskOutput = ImageTransparencyTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends ImageTaskBase<Input, Output, Config> {
  static override readonly type = "ImageTransparencyTask";
  static override readonly category = "Image";
  public static override title = "Set Transparency";
  public static override description = "Adjusts the opacity of an image";

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
    const image = await runImageOp(input.image, TRANSPARENCY_OP, { opacity: input.opacity });
    return { image: image as unknown as Output["image"] } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageTransparency: CreateWorkflow<
      ImageTransparencyTaskInput,
      ImageTransparencyTaskOutput,
      TaskConfig
    >;
  }
}

Workflow.prototype.imageTransparency = CreateWorkflow(ImageTransparencyTask);
