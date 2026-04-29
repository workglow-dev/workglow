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
import {
  CpuImage,
  getPreviewBudget,
  GpuImageSchema,
  resolveColor,
  type GpuImage,
  type RgbaImageBinary,
} from "@workglow/util/media";
import type { DataPortSchema } from "@workglow/util/schema";
import { FromSchema } from "@workglow/util/schema";
import { ColorValueSchema } from "../ImageSchemas";
import {
  IMAGE_TEXT_ANCHOR_POSITIONS,
  renderImageTextToRgba,
  type ImageTextAnchorPosition,
} from "../imageTextRender";

function toRgbaImage(image: {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly channels: number;
}): RgbaImageBinary {
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
): RgbaImageBinary {
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

const backgroundImageProperty = GpuImageSchema({
  title: "Image",
  description: "Background image to render the text onto",
});

const inputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "Text to render (use \\n for line breaks)",
      minLength: 1,
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
    color: ColorValueSchema({ title: "Color", description: "Text color" }),
    position: {
      type: "string",
      title: "Position",
      description: "Anchor position of the text block within the image",
      enum: [...IMAGE_TEXT_ANCHOR_POSITIONS],
      default: "middle-center",
      "x-ui-enum-labels": IMAGE_TEXT_POSITION_LABELS,
    },
    image: backgroundImageProperty,
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
  },
  required: ["text", "color"],
  additionalProperties: false,
  if: {
    not: {
      required: ["image"],
    },
  },
  then: {
    required: ["width", "height"],
  },
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    image: GpuImageSchema({ title: "Image", description: "Raster image with text" }),
  },
  required: ["image"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type ImageTextTaskInput = FromSchema<typeof inputSchema>;
export type ImageTextTaskOutput = { image: GpuImage };

async function runText(input: ImageTextTaskInput): Promise<ImageTextTaskOutput> {
  const color = resolveColor(input.color);
  const fontSize = input.fontSize ?? 24;
  const font = input.font ?? "sans-serif";
  const bold = input.bold ?? false;
  const italic = input.italic ?? false;
  const position = (input.position ?? "middle-center") as ImageTextAnchorPosition;

  const backgroundImage = "image" in input ? (input.image as GpuImage | undefined) : undefined;

  if (backgroundImage != null) {
    const background = await backgroundImage.materialize();
    const overlay = await renderImageTextToRgba({
      text: input.text,
      font,
      fontSize,
      bold,
      italic,
      color,
      width: background.width,
      height: background.height,
      position,
    });
    const composited = compositeTextOverBackground(background, overlay);
    return { image: CpuImage.fromImageBinary(composited) as unknown as GpuImage };
  }

  if (
    !("width" in input) ||
    !("height" in input) ||
    typeof input.width !== "number" ||
    typeof input.height !== "number"
  ) {
    throw new Error(
      "ImageTextTask: width and height are required when no background image is provided"
    );
  }

  const textBinary = await renderImageTextToRgba({
    text: input.text,
    font,
    fontSize,
    bold,
    italic,
    color,
    width: input.width,
    height: input.height,
    position,
  });
  return { image: CpuImage.fromImageBinary(textBinary) as unknown as GpuImage };
}

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

  static override inputSchema(): DataPortSchema {
    return inputSchema;
  }

  static override outputSchema(): DataPortSchema {
    return outputSchema;
  }

  override getDefaultInputsFromStaticInputDefinitions(): Partial<Input> {
    const defaults = super.getDefaultInputsFromStaticInputDefinitions() as Record<string, unknown>;
    delete defaults.image;
    delete defaults.width;
    delete defaults.height;
    return defaults as Partial<Input>;
  }

  override async execute(input: Input, _context: IExecuteContext): Promise<Output | undefined> {
    return (await runText(input)) as Output;
  }

  override async executePreview(
    input: Input,
    _context: IExecutePreviewContext
  ): Promise<Output | undefined> {
    const color = resolveColor(input.color);
    const fontSize = input.fontSize ?? 24;
    const font = input.font ?? "sans-serif";
    const bold = input.bold ?? false;
    const italic = input.italic ?? false;
    const position = (input.position ?? "middle-center") as ImageTextAnchorPosition;
    const backgroundImage = "image" in input ? (input.image as GpuImage | undefined) : undefined;

    if (backgroundImage != null) {
      // With-background case: inherit scale from the background image and apply
      // it to the user-provided fontSize so glyph stroke widths match the
      // already-downscaled background.
      const s = backgroundImage.previewScale;
      const background = await backgroundImage.materialize();
      const scaledFontSize = Math.max(1, Math.round(fontSize * s));
      const overlay = await renderImageTextToRgba({
        text: input.text,
        font,
        fontSize: scaledFontSize,
        bold,
        italic,
        color,
        width: background.width,
        height: background.height,
        position,
      });
      const composited = compositeTextOverBackground(background, overlay);
      return { image: CpuImage.fromImageBinary(composited, s) as unknown as GpuImage } as Output;
    }

    // Without-background source case: this task IS the source, so apply the
    // preview budget here against the user-supplied output dimensions.
    if (
      !("width" in input) ||
      !("height" in input) ||
      typeof input.width !== "number" ||
      typeof input.height !== "number"
    ) {
      throw new Error(
        "ImageTextTask: width and height are required when no background image is provided"
      );
    }
    const longEdge = Math.max(input.width, input.height);
    const budget = getPreviewBudget();
    const s = longEdge > budget ? budget / longEdge : 1.0;
    const scaledFontSize = Math.max(1, Math.round(fontSize * s));
    const scaledWidth = Math.max(1, Math.round(input.width * s));
    const scaledHeight = Math.max(1, Math.round(input.height * s));
    const textBinary = await renderImageTextToRgba({
      text: input.text,
      font,
      fontSize: scaledFontSize,
      bold,
      italic,
      color,
      width: scaledWidth,
      height: scaledHeight,
      position,
    });
    return { image: CpuImage.fromImageBinary(textBinary, s) as unknown as GpuImage } as Output;
  }
}

declare module "@workglow/task-graph" {
  interface Workflow {
    imageText: CreateWorkflow<ImageTextTaskInput, ImageTextTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.imageText = CreateWorkflow(ImageTextTask);
