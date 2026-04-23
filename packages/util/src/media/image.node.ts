/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageBinary, ImageChannels, ImageDataSupport, RgbaImageBinary } from "./image";
import { parseDataUri } from "./image";

export { parseDataUri };
export type { ImageBinary, ImageChannels, ImageDataSupport, RgbaImageBinary };

async function dataUriToBlob(string: string): Promise<Blob> {
  const { mimeType, base64 } = parseDataUri(string);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function convertImageDataToUseableForm(
  imageData: unknown,
  supports: ImageDataSupport[]
): Promise<unknown> {
  if (imageData === null || imageData === undefined) {
    throw new Error("Image data is null or undefined");
  }

  // first check if the image data is already in the supported format
  if (supports.includes("Blob") && imageData instanceof Blob) {
    return imageData;
  }

  if (
    supports.includes("ImageBinary") &&
    typeof imageData === "object" &&
    "data" in imageData &&
    "width" in imageData &&
    "height" in imageData &&
    "channels" in imageData
  ) {
    return {
      data: imageData.data,
      width: imageData.width,
      height: imageData.height,
      channels: imageData.channels,
    };
  }

  // if not, convert it to the first supported format
  if (supports.includes("Blob") && typeof imageData === "string") {
    return await dataUriToBlob(imageData);
  }

  if (
    supports.includes("DataUri") &&
    typeof imageData === "string" &&
    imageData.startsWith("data:")
  ) {
    return imageData;
  }

  throw new Error(`Unsupported image data type: ${typeof imageData}`);
}
