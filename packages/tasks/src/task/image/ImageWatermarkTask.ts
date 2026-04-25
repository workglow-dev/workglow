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
import { produceImageOutput } from "./imageTaskIo";
import { Image } from "@workglow/util/media";

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Source image" }),
    spacing: {
      type: "integer",
      title: "Spacing",
      description: "Pattern spacing in pixels",
      minimum: 8,
      default: 64,
    },
    opacity: {
      type: "number",
      title: "Opacity",
      description: "Watermark opacity (0.0-1.0)",
      minimum: 0,
      maximum: 1,
      default: 0.3,
    },
    pattern: {
      type: "string",
      enum: ["diagonal-lines", "grid", "dots"],
      title: "Pattern",
      description: "Watermark pattern type",
      default: "diagonal-lines",
    },
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Watermarked image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageWatermarkTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageWatermarkTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageWatermarkTask<
  Input extends ImageWatermarkTaskInput = ImageWatermarkTaskInput,
  Output extends ImageWatermarkTaskOutput = ImageWatermarkTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends ImageTaskBase<Input, Output, Config> {
  static override readonly type = "ImageWatermarkTask";
  static override readonly category = "Image";
  public static override title = "Add Watermark";
  public static override description = "Adds a repeating pattern watermark to an image";

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
    const { spacing = 64, opacity = 0.3, pattern = "diagonal-lines" } = input;
    const image = await produceImageOutput(input.image, (img) => {
      const { data: src, width, height, channels: srcCh } = img;
      const outCh = 4;
      const dst = new Uint8ClampedArray(width * height * outCh);
      const lineWidth = 2;
      const dotRadius = Math.max(2, spacing >> 3);
      const dotRadiusSq = dotRadius * dotRadius;
      const half = spacing >> 1;
      const alpha = Math.round(opacity * 255);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const srcIdx = (y * width + x) * srcCh;
          const dstIdx = (y * width + x) * outCh;

          // Read source pixel
          const sr = src[srcIdx];
          const sg = srcCh >= 3 ? src[srcIdx + 1] : sr;
          const sb = srcCh >= 3 ? src[srcIdx + 2] : sr;
          const sa = srcCh === 4 ? src[srcIdx + 3] : 255;

          // Check if this pixel is part of the watermark pattern
          let isPattern = false;
          if (pattern === "diagonal-lines") {
            isPattern = (x + y) % spacing < lineWidth;
          } else if (pattern === "grid") {
            isPattern = x % spacing < lineWidth || y % spacing < lineWidth;
          } else {
            const dx = (x % spacing) - half;
            const dy = (y % spacing) - half;
            isPattern = dx * dx + dy * dy < dotRadiusSq;
          }

          if (isPattern) {
            // Blend white watermark with source
            const blend = alpha;
            const invBlend = 255 - blend;
            dst[dstIdx] = (sr * invBlend + 255 * blend + 127) / 255;
            dst[dstIdx + 1] = (sg * invBlend + 255 * blend + 127) / 255;
            dst[dstIdx + 2] = (sb * invBlend + 255 * blend + 127) / 255;
            dst[dstIdx + 3] = sa;
          } else {
            dst[dstIdx] = sr;
            dst[dstIdx + 1] = sg;
            dst[dstIdx + 2] = sb;
            dst[dstIdx + 3] = sa;
          }
        }
      }

      return { data: dst, width, height, channels: outCh };
    });
    return { image: Image.fromPixels(image) as unknown as Output["image"] } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageWatermark: CreateWorkflow<ImageWatermarkTaskInput, ImageWatermarkTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageWatermark = CreateWorkflow(ImageWatermarkTask);
