/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export type ImageChannels = 1 | 3 | 4; // grayscale, rgb, rgba

export type ImageDataSupport =
  | "Blob"
  | "ImageBinary"
  | "ImageBitmap"
  | "OffscreenCanvas"
  | "VideoFrame"
  | "RawImage"
  | "DataUri"
  | "Sharp";

export interface ImageBinary {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  channels: ImageChannels;
  rawChannels?: number | undefined;
}

/** RGBA pixel buffer (`channels` is always 4). */
export type RgbaImageBinary = Readonly<
  Omit<ImageBinary, "channels" | "rawChannels"> & { readonly channels: 4 }
>;

export function parseDataUri(dataUri: string): {
  mimeType: string;
  base64: string;
} {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid base64 data URI");
  }

  return {
    mimeType: match[1], // e.g. "image/png"
    base64: match[2],
  };
}
