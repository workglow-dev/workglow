/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
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
import { ColorSchema, ImageBinaryOrDataUriSchema, ImageFromSchema } from "./ImageSchemas";
import { produceImageOutput } from "./imageTaskIo";
import {
  IMAGE_TEXT_ANCHOR_POSITIONS,
  type ImageTextAnchorPosition,
  renderImageTextToRgba,
} from "./imageTextRender";

function toRgbaImage(image: {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly channels: number;
}): {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly channels: 4;
} {
  const { data, width, height, channels } = image;
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (channels === 4) {
    rgba.set(data);
    return { data: rgba, width, height, channels: 4 };
  }
  if (channels === 3) {
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = data[i * 3] ?? 0;
      rgba[i * 4 + 1] = data[i * 3 + 1] ?? 0;
      rgba[i * 4 + 2] = data[i * 3 + 2] ?? 0;
      rgba[i * 4 + 3] = 255;
    }
    return { data: rgba, width, height, channels: 4 };
  }
  if (channels === 1) {
    for (let i = 0; i < width * height; i++) {
      const gray = data[i] ?? 0;
      rgba[i * 4] = gray;
      rgba[i * 4 + 1] = gray;
      rgba[i * 4 + 2] = gray;
      rgba[i * 4 + 3] = 255;
    }
    return { data: rgba, width, height, channels: 4 };
  }
  throw new Error(`ImageTextTask: unsupported background channel count: ${channels}`);
}

function compositeTextOverBackground(
  background: {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly channels: number;
  },
  overlay: {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly channels: number;
  }
): {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly channels: 4;
} {
  if (background.width !== overlay.width || background.height !== overlay.height) {
    throw new Error("ImageTextTask: background and text overlay dimensions must match");
  }
  if (overlay.channels !== 4) {
    throw new Error(`ImageTextTask: expected RGBA text overlay, got ${overlay.channels} channels`);
  }
  const bg = toRgbaImage(background);
  const out = new Uint8ClampedArray(bg.data);
  for (let i = 0; i < out.length; i += 4) {
    const srcA = (overlay.data[i + 3] ?? 0) / 255;
    if (srcA <= 0) continue;
    const dstA = (out[i + 3] ?? 0) / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }

    const srcR = (overlay.data[i] ?? 0) / 255;
    const srcG = (overlay.data[i + 1] ?? 0) / 255;
    const srcB = (overlay.data[i + 2] ?? 0) / 255;
    const dstR = (out[i] ?? 0) / 255;
    const dstG = (out[i + 1] ?? 0) / 255;
    const dstB = (out[i + 2] ?? 0) / 255;

    out[i] = Math.round(((srcR * srcA + dstR * dstA * (1 - srcA)) / outA) * 255);
    out[i + 1] = Math.round(((srcG * srcA + dstG * dstA * (1 - srcA)) / outA) * 255);
    out[i + 2] = Math.round(((srcB * srcA + dstB * dstA * (1 - srcA)) / outA) * 255);
    out[i + 3] = Math.round(outA * 255);
  }
  return { data: out, width: bg.width, height: bg.height, channels: 4 };
}

function hasUsableBackgroundImage(value: unknown): value is ImageTextTaskInput["image"] {
  if (typeof value === "string") {
    return value.length > 0;
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.width === "number" &&
    typeof candidate.height === "number" &&
    typeof candidate.channels === "number" &&
    candidate.data !== undefined
  );
}

const IMAGE_TEXT_POSITION_LABELS: Record<ImageTextAnchorPosition, string> = {
  "top-left": "Top left",
  "top-center": "Top center",
  "top-right": "Top right",
  "middle-left": "Middle left",
  "middle-center": "Middle center",
  "middle-right": "Middle right",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom center",
  "bottom-right": "Bottom right",
};

const inputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({
      title: "Image",
      description: "Optional background image to render the text onto",
    }),
    text: {
      type: "string",
      title: "Text",
      description: "Text to render (use \\n for line breaks)",
    },
    font: {
      type: "string",
      title: "Font",
      description: "CSS font family name (e.g. sans-serif, Arial)",
      default: "sans-serif",
    },
    fontSize: {
      type: "integer",
      title: "Font size",
      description: "Font size in pixels",
      minimum: 1,
      default: 24,
    },
    bold: { type: "boolean", title: "Bold", default: false },
    italic: { type: "boolean", title: "Italic", default: false },
    color: ColorSchema({ title: "Color", description: "Text color" }),
    width: {
      type: "integer",
      title: "Width",
      description: "Output width in pixels",
      minimum: 1,
    },
    height: {
      type: "integer",
      title: "Height",
      description: "Output height in pixels",
      minimum: 1,
    },
    position: {
      type: "string",
      title: "Position",
      description: "Anchor position of the text block within the image",
      enum: [...IMAGE_TEXT_ANCHOR_POSITIONS],
      default: "middle-center",
      "x-ui-enum-labels": IMAGE_TEXT_POSITION_LABELS,
    },
  },
  required: ["text", "color", "width", "height"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: ImageBinaryOrDataUriSchema({ title: "Image", description: "Raster image with text" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageTextTaskInput = ImageFromSchema<typeof inputSchema>;
export type ImageTextTaskOutput = ImageFromSchema<typeof outputSchema>;

export class ImageTextTask<
  Input extends ImageTextTaskInput = ImageTextTaskInput,
  Output extends ImageTextTaskOutput = ImageTextTaskOutput,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  static override readonly type = "ImageTextTask";
  static override readonly category = "Image";
  public static override title = "Render Text to Image";
  public static override description =
    "Renders text onto a transparent RGBA image or overlays it on an optional background image";

  static override inputSchema() {
    return inputSchema;
  }

  static override outputSchema() {
    return outputSchema;
  }

  override getDefaultInputsFromStaticInputDefinitions(): Partial<Input> {
    const defaults = super.getDefaultInputsFromStaticInputDefinitions();
    delete (defaults as { image?: unknown }).image;
    return defaults;
  }

  override async executeReactive(
    input: Input,
    _output: Output,
    _context: IExecuteReactiveContext
  ): Promise<Output> {
    const fontSize = input.fontSize ?? 24;
    const font = input.font ?? "sans-serif";
    const bold = input.bold ?? false;
    const italic = input.italic ?? false;
    const position = (input.position ?? "middle-center") as ImageTextAnchorPosition;

    const renderParams = {
      text: input.text,
      font,
      fontSize,
      bold,
      italic,
      color: input.color,
      width: input.width,
      height: input.height,
      position,
    };

    const backgroundImage = input.image;
    let image: ImageTextTaskOutput["image"];
    if (hasUsableBackgroundImage(backgroundImage)) {
      const validatedBackgroundImage = backgroundImage as Exclude<
        typeof backgroundImage,
        undefined
      >;
      image = await produceImageOutput(validatedBackgroundImage, async (background) => {
        if (background.width !== input.width || background.height !== input.height) {
          throw new Error(
            `ImageTextTask: background image dimensions (${background.width}x${background.height}) must match width/height (${input.width}x${input.height})`
          );
        }
        const overlay = await renderImageTextToRgba(renderParams);
        return compositeTextOverBackground(background, overlay);
      });
    } else {
      image = await renderImageTextToRgba(renderParams);
    }
    return { image } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageText: CreateWorkflow<ImageTextTaskInput, ImageTextTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageText = CreateWorkflow(ImageTextTask);
