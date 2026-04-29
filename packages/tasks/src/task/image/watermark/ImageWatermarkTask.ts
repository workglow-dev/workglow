/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import {
  CreateWorkflow,
  Task,
  Workflow,
  type IExecuteContext,
  type IExecutePreviewContext,
  type TaskConfig,
} from "@workglow/task-graph";
import { CpuImage, GpuImageSchema, type GpuImage } from "@workglow/util/media";
import type { DataPortSchema } from "@workglow/util/schema";

const inputSchema = {
  type: "object",
  properties: {
    image: GpuImageSchema({ title: "Image", description: "Source image" }),
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
    image: GpuImageSchema({ title: "Image", description: "Watermarked image" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface ImageWatermarkTaskInput extends Record<string, unknown> {
  image: GpuImage;
  spacing?: number;
  opacity?: number;
  pattern?: "diagonal-lines" | "grid" | "dots";
}

export interface ImageWatermarkTaskOutput extends Record<string, unknown> {
  image: GpuImage;
}

async function runWatermark(input: ImageWatermarkTaskInput): Promise<ImageWatermarkTaskOutput> {
  const { spacing = 64, opacity = 0.3, pattern = "diagonal-lines" } = input;
  const img = await input.image.materialize();
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

      const sr = src[srcIdx]!;
      const sg = srcCh >= 3 ? src[srcIdx + 1]! : sr;
      const sb = srcCh >= 3 ? src[srcIdx + 2]! : sr;
      const sa = srcCh === 4 ? src[srcIdx + 3]! : 255;

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

  const outBin = { data: dst, width, height, channels: outCh as 4 };
  return { image: CpuImage.fromImageBinary(outBin) as unknown as GpuImage };
}

export class ImageWatermarkTask<
  Input extends ImageWatermarkTaskInput = ImageWatermarkTaskInput,
  Output extends ImageWatermarkTaskOutput = ImageWatermarkTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "ImageWatermarkTask";
  static override readonly category = "Image";
  public static override title = "Add Watermark";
  public static override description = "Adds a repeating pattern watermark to an image";

  static override inputSchema(): DataPortSchema {
    return inputSchema;
  }

  static override outputSchema(): DataPortSchema {
    return outputSchema;
  }

  override async execute(input: Input, _context: IExecuteContext): Promise<Output | undefined> {
    return (await runWatermark(input)) as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    return (await runWatermark(input)) as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageWatermark: CreateWorkflow<ImageWatermarkTaskInput, ImageWatermarkTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageWatermark = CreateWorkflow(ImageWatermarkTask);
