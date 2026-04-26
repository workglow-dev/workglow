/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreateWorkflow,
  IExecuteContext,
  IExecutePreviewContext,
  Task,
  TaskConfig,
  Workflow,
} from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util/schema";
import { ImageBinaryOrDataUriSchema, ImageFromSchema } from "./ImageSchemas";
import { produceImageOutput } from "./imageTaskIo";

async function applyTransparency(
  input: ImageTransparencyTaskInput
): Promise<ImageTransparencyTaskOutput> {
  const { opacity } = input;
  const image = await produceImageOutput(input.image, (img) => {
    const { data: src, width, height, channels: srcCh } = img;
    const pixelCount = width * height;
    const dst = new Uint8ClampedArray(pixelCount * 4);
    const alphaScale = Math.round(opacity * 255);

    for (let i = 0; i < pixelCount; i++) {
      const srcIdx = i * srcCh;
      const dstIdx = i * 4;
      dst[dstIdx] = src[srcIdx];
      dst[dstIdx + 1] = srcCh >= 3 ? src[srcIdx + 1] : src[srcIdx];
      dst[dstIdx + 2] = srcCh >= 3 ? src[srcIdx + 2] : src[srcIdx];
      const srcAlpha = srcCh === 4 ? src[srcIdx + 3] : 255;
      dst[dstIdx + 3] = (srcAlpha * alphaScale + 127) / 255;
    }

    return { data: dst, width, height, channels: 4 };
  });
  return { image };
}

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
> extends Task<Input, Output, Config> {
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

  override async execute(input: Input, _context: IExecuteContext): Promise<Output | undefined> {
    return (await applyTransparency(input)) as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return (await applyTransparency(input)) as Output;
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
