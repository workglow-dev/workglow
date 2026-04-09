/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecuteReactiveContext,
  Task,
  TaskConfig,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util/schema";
import { ColorSchema, ImageBinarySchema, ImageFromSchema } from "./ImageSchemas";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinarySchema({ title: "Image", description: "Source image" }),
    borderWidth: {
      type: "integer",
      title: "Border Width",
      description: "Border width in pixels",
      minimum: 1,
      default: 1,
    },
    color: ColorSchema({ title: "Color", description: "Border color" }),
  },
  required: ["image", "borderWidth", "color"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinarySchema({ title: "Image", description: "Image with border" }),
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
> extends Task<Input, Output, Config> {
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
    const { image, borderWidth: bw, color } = input;
    const { data: src, width: srcW, height: srcH, channels: srcCh } = image;
    const outCh = 4;
    const dstW = srcW + bw * 2;
    const dstH = srcH + bw * 2;
    const dst = new Uint8ClampedArray(dstW * dstH * outCh);

    const r = color.r;
    const g = color.g;
    const b = color.b;
    const a = color.a ?? 255;

    // Fill entire image with border color
    for (let i = 0; i < dst.length; i += outCh) {
      dst[i] = r;
      dst[i + 1] = g;
      dst[i + 2] = b;
      dst[i + 3] = a;
    }

    // Copy source image into center
    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        const srcIdx = (y * srcW + x) * srcCh;
        const dstIdx = ((y + bw) * dstW + (x + bw)) * outCh;
        dst[dstIdx] = src[srcIdx];
        dst[dstIdx + 1] = srcCh >= 3 ? src[srcIdx + 1] : src[srcIdx];
        dst[dstIdx + 2] = srcCh >= 3 ? src[srcIdx + 2] : src[srcIdx];
        dst[dstIdx + 3] = srcCh === 4 ? src[srcIdx + 3] : 255;
      }
    }

    return {
      image: { data: dst, width: dstW, height: dstH, channels: outCh },
    } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageBorder: CreateWorkflow<ImageBorderTaskInput, ImageBorderTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageBorder = CreateWorkflow(ImageBorderTask);
