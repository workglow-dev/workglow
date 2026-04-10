/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageBinary } from "@workglow/util/media";

import type { ImageRasterCodec } from "./imageRasterCodecRegistry";

function normalizeMimeType(mimeType: string): "image/jpeg" | "image/png" | "image/webp" {
  const m = mimeType.toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) {
    return "image/jpeg";
  }
  if (m.includes("webp")) {
    return "image/webp";
  }
  return "image/png";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function rasterToImageData(image: ImageBinary): ImageData {
  const { width, height, channels, data } = image;
  const id = new ImageData(width, height);
  if (channels === 4) {
    id.data.set(data);
    return id;
  }
  if (channels === 3) {
    for (let i = 0; i < width * height; i++) {
      id.data[i * 4] = data[i * 3]!;
      id.data[i * 4 + 1] = data[i * 3 + 1]!;
      id.data[i * 4 + 2] = data[i * 3 + 2]!;
      id.data[i * 4 + 3] = 255;
    }
    return id;
  }
  if (channels === 1) {
    for (let i = 0; i < width * height; i++) {
      const v = data[i]!;
      id.data[i * 4] = v;
      id.data[i * 4 + 1] = v;
      id.data[i * 4 + 2] = v;
      id.data[i * 4 + 3] = 255;
    }
    return id;
  }
  throw new Error(`Unsupported channel count: ${channels}`);
}

function get2dContext(
  width: number,
  height: number
): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context (OffscreenCanvas)");
    }
    return { canvas, ctx };
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context (HTMLCanvasElement)");
    }
    return { canvas, ctx };
  }
  throw new Error("No Canvas implementation available in this environment");
}

async function decodeDataUri(dataUri: string): Promise<ImageBinary> {
  const response = await fetch(dataUri);
  const blob = await response.blob();
  const bmp = await createImageBitmap(blob);
  const { ctx } = get2dContext(bmp.width, bmp.height);
  ctx.drawImage(bmp, 0, 0);
  const id = ctx.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close();
  return {
    data: new Uint8ClampedArray(id.data),
    width: id.width,
    height: id.height,
    channels: 4,
  };
}

async function encodeDataUri(image: ImageBinary, mimeType: string): Promise<string> {
  const fmt = normalizeMimeType(mimeType);
  const { canvas, ctx } = get2dContext(image.width, image.height);
  ctx.putImageData(rasterToImageData(image), 0, 0);

  if (canvas instanceof OffscreenCanvas) {
    const quality = fmt === "image/jpeg" ? 0.92 : undefined;
    const blob = await canvas.convertToBlob({ type: fmt, quality });
    const buf = await blob.arrayBuffer();
    return `data:${fmt};base64,${arrayBufferToBase64(buf)}`;
  }

  const htmlCanvas = canvas as HTMLCanvasElement;
  const dataUrl = htmlCanvas.toDataURL(fmt, fmt === "image/jpeg" ? 0.92 : undefined);
  return dataUrl;
}

export function createBrowserImageRasterCodec(): ImageRasterCodec {
  return { decodeDataUri, encodeDataUri };
}
