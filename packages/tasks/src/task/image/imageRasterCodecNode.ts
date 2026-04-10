/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageBinary, ImageChannels } from "@workglow/util/media";
import { parseDataUri } from "@workglow/util/media";

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

function expandGrayAlphaToRgba(src: Buffer, width: number, height: number): Uint8ClampedArray {
  const n = width * height;
  const dst = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const g = src[i * 2]!;
    const a = src[i * 2 + 1]!;
    dst[i * 4] = g;
    dst[i * 4 + 1] = g;
    dst[i * 4 + 2] = g;
    dst[i * 4 + 3] = a;
  }
  return dst;
}

async function decodeDataUri(dataUri: string): Promise<ImageBinary> {
  let sharp: typeof import("sharp").default;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    throw new Error(
      "The Node/Bun image raster codec requires the optional 'sharp' package. " +
        "Install it with: npm install sharp  (or bun add sharp)"
    );
  }
  const { base64 } = parseDataUri(dataUri);
  const buffer = Buffer.from(base64, "base64");
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const ch = info.channels;

  if (ch === 2) {
    return {
      data: expandGrayAlphaToRgba(data, width, height),
      width,
      height,
      channels: 4,
    };
  }
  if (ch === 1 || ch === 3 || ch === 4) {
    return {
      data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      width,
      height,
      channels: ch as ImageChannels,
    };
  }
  throw new Error(`Unsupported decoded channel count: ${ch}`);
}

async function encodeDataUri(image: ImageBinary, mimeType: string): Promise<string> {
  let sharp: typeof import("sharp").default;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    throw new Error(
      "The Node/Bun image raster codec requires the optional 'sharp' package. " +
        "Install it with: npm install sharp  (or bun add sharp)"
    );
  }
  const { data, width, height, channels } = image;
  const fmt = normalizeMimeType(mimeType);
  const base = sharp(Buffer.from(data), { raw: { width, height, channels } });

  const out =
    fmt === "image/jpeg"
      ? await base.jpeg({ quality: 92, mozjpeg: true }).toBuffer()
      : fmt === "image/webp"
        ? await base.webp({ quality: 92 }).toBuffer()
        : await base.png({ compressionLevel: 6 }).toBuffer();

  return `data:${fmt};base64,${out.toString("base64")}`;
}

export function createNodeImageRasterCodec(): ImageRasterCodec {
  return { decodeDataUri, encodeDataUri };
}
