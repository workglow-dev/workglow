/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageBinary } from "@workglow/util/media";

import { getImageRasterCodec } from "./imageRasterCodecRegistry";

export type ImageTransportKind = "binary" | "dataUri";

export interface ImageTransport {
  readonly kind: ImageTransportKind;
  /** Present when kind === "dataUri"; used to encode the result. */
  readonly mimeType: string;
}

export function isDataUriImage(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:");
}

function parseDataUriMimeType(dataUri: string): string {
  const match = dataUri.match(/^data:([^;,]+)/);
  const raw = match?.[1]?.trim();
  if (!raw) {
    return "image/png";
  }
  return raw.toLowerCase();
}

export async function resolveImageInput(
  value: ImageBinary | string
): Promise<{ readonly raster: ImageBinary; readonly transport: ImageTransport }> {
  if (isDataUriImage(value)) {
    const mimeType = parseDataUriMimeType(value);
    const raster = await getImageRasterCodec().decodeDataUri(value);
    return { raster, transport: { kind: "dataUri", mimeType } };
  }
  return { raster: value, transport: { kind: "binary", mimeType: "image/png" } };
}

export async function formatImageOutput(
  raster: ImageBinary,
  transport: ImageTransport
): Promise<ImageBinary | string> {
  if (transport.kind === "binary") {
    return raster;
  }
  return getImageRasterCodec().encodeDataUri(raster, transport.mimeType);
}
