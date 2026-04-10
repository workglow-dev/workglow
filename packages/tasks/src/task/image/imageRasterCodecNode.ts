/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageBinary, ImageChannels } from "@workglow/util/media";
import { parseDataUri } from "@workglow/util/media";

import {
  MAX_DECODED_PIXELS,
  MAX_INPUT_BYTES_NODE,
  REJECTED_DECODE_MIME_TYPES,
  assertIsDataUri,
  assertWithinByteBudget,
  assertWithinPixelBudget,
  extractDataUriMimeType,
  normalizeOutputMimeType,
} from "./imageCodecLimits";
import type { ImageRasterCodec } from "./imageRasterCodecRegistry";

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

let _sharp: typeof import("sharp") | undefined;

async function getSharp() {
  if (!_sharp) {
    try {
      _sharp = (await import("sharp")).default;
    } catch {
      throw new Error(
        "The Node/Bun image raster codec requires the optional 'sharp' package. " +
          "Install it with: npm install sharp  (or bun add sharp)"
      );
    }
  }
  return _sharp;
}

async function decodeDataUri(dataUri: string): Promise<ImageBinary> {
  // Defense in depth: the codec must not trust its caller. An accidental
  // `fetch`/`Buffer.from` path is not reachable here today, but refusing
  // anything that is not a data URI keeps that door shut.
  assertIsDataUri(dataUri);

  const declaredMime = extractDataUriMimeType(dataUri);
  if (declaredMime && REJECTED_DECODE_MIME_TYPES.has(declaredMime)) {
    throw new Error(
      `Image raster codec: refusing to rasterize "${declaredMime}". ` +
        `Vector and animated formats lose information when converted to pixels. ` +
        `Convert to PNG, JPEG, or WebP before passing to the codec.`
    );
  }

  const sharp = await getSharp();
  const { base64 } = parseDataUri(dataUri);
  const buffer = Buffer.from(base64, "base64");
  assertWithinByteBudget(buffer.byteLength, MAX_INPUT_BYTES_NODE);

  // `limitInputPixels` rejects header-declared pixel bombs before decompression.
  // `sequentialRead` lowers peak memory for large inputs.
  const { data, info } = await sharp(buffer, {
    limitInputPixels: MAX_DECODED_PIXELS,
    sequentialRead: true,
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const ch = info.channels;

  // Belt-and-suspenders: sharp should have rejected already, but assert on the
  // post-decode dimensions too so any future sharp option change cannot
  // silently disable the pixel budget.
  assertWithinPixelBudget(width, height);

  if (ch === 2) {
    return {
      data: expandGrayAlphaToRgba(data, width, height),
      width,
      height,
      channels: 4,
    };
  }
  if (ch === 1 || ch === 3 || ch === 4) {
    // IMPORTANT: copy, do not alias. Node Buffers up to ~4 KiB are sliced out
    // of a shared pool (`Buffer.poolSize / 2`), so aliasing `data.buffer`
    // would expose unrelated pool memory through the Uint8ClampedArray view,
    // and downstream pixel mutations would corrupt sibling allocations. The
    // `TypedArray(typedArray)` constructor allocates a fresh ArrayBuffer and
    // element-wise copies — matching the pattern in `expandGrayAlphaToRgba`.
    return {
      data: new Uint8ClampedArray(data),
      width,
      height,
      channels: ch as ImageChannels,
    };
  }
  throw new Error(`Unsupported decoded channel count: ${ch}`);
}

async function encodeDataUri(image: ImageBinary, mimeType: string): Promise<string> {
  const sharp = await getSharp();
  const { data, width, height, channels } = image;
  const fmt = normalizeOutputMimeType(mimeType);
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
