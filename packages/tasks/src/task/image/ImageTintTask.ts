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
import { ColorValueSchema, ImageBinaryOrDataUriSchema, ImageFromSchema } from "./ImageSchemas";
import { resolveColor } from "@workglow/util/media";
import { ImageTaskBase } from "./ImageTaskBase";
import { runImageOp } from "./imageOpDispatcher";
import { TINT_OP, ensureImageGpuApi } from "./imageOps";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
    color: ColorValueSchema({ title: "Color", description: "Tint color" }),
    amount: {
      type: "number",
      title: "Amount",
      description: "Tint strength (0.0 = no tint, 1.0 = full tint color)",
      minimum: 0,
      maximum: 1,
      default: 0.5,
    },
  },
  required: ["image", "color"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Tinted image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageTintTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageTintTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageTintTask<
  Input extends ImageTintTaskInput = ImageTintTaskInput,
  Output extends ImageTintTaskOutput = ImageTintTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends ImageTaskBase<Input, Output, Config> {
  static override readonly type = "ImageTintTask";
  static override readonly category = "Image";
  public static override title = "Tint Image";
  public static override description = "Applies a color tint to an image";

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
    const { r, g, b } = resolveColor(input.color);
    const amount = input.amount ?? 0.5;
    const image = await runImageOp(input.image, TINT_OP, { r, g, b, amount });
    return { image: image as unknown as Output["image"] } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageTint: CreateWorkflow<ImageTintTaskInput, ImageTintTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageTint = CreateWorkflow(ImageTintTask);
