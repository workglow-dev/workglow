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
import { resolveColor } from "@workglow/util/media";
import { DataPortSchema } from "@workglow/util/schema";
import { ColorValueSchema, ImageBinaryOrDataUriSchema, ImageFromSchema } from "./ImageSchemas";
import { ImageTaskBase } from "./ImageTaskBase";
import { runImageResizeOp } from "./imageOpDispatcher";
import { BORDER_OP } from "./imageOps";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
    borderWidth: {
      type: "integer",
      title: "Border Width",
      description: "Border width in pixels",
      minimum: 1,
      default: 1,
    },
    color: ColorValueSchema({ title: "Color", description: "Border color" }),
  },
  required: ["image", "color"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Image with border" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageBorderTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageBorderTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageBorderTask<
  Input extends ImageBorderTaskInput = ImageBorderTaskInput,
  Output extends ImageBorderTaskOutput = ImageBorderTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends ImageTaskBase<Input, Output, Config> {
  static override readonly type = "ImageBorderTask";
  static override readonly category = "Image";
  public static override title = "Add Border";
  public static override description = "Adds a colored border around an image";

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
    const { r, g, b, a } = resolveColor(input.color);
    const borderWidth = input.borderWidth ?? 1;
    const image = await runImageResizeOp(input.image, BORDER_OP, {
      borderWidth,
      r,
      g,
      b,
      a,
    });
    return { image: image as unknown as Output["image"] } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageBorder: CreateWorkflow<ImageBorderTaskInput, ImageBorderTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageBorder = CreateWorkflow(ImageBorderTask);
