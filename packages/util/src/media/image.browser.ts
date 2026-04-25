/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageBinary, ImageChannels, ImageDataSupport, RgbaImageBinary } from "./image";
import { parseDataUri } from "./image";

export { parseDataUri };
export type { ImageBinary, ImageChannels, ImageDataSupport, RgbaImageBinary };

const convertBlobToOffscreenCanvas = async (blob: Blob): Promise<OffscreenCanvas> => {
  const img = await createImageBitmap(blob);
  const ctx = new OffscreenCanvas(img.width, img.height).getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get context.");
  }
  ctx.drawImage(img, 0, 0);
  return ctx.canvas;
};

function dataUriToBlob(dataUri: string): Blob {
  const { mimeType, base64 } = parseDataUri(dataUri);

  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  const blob = new Blob([bytes], { type: mimeType });
  return blob;
}

export async function convertImageDataToUseableForm(
  imageData: unknown,
  supports: ImageDataSupport[]
): Promise<unknown> {
  if (imageData === null || imageData === undefined) {
    throw new Error("Image data is null or undefined");
  }

  // first check if the image data is already in the supported format
  if (supports.includes("ImageBitmap") && imageData instanceof ImageBitmap) {
    return imageData;
  }
  if (supports.includes("VideoFrame") && imageData instanceof VideoFrame) {
    return imageData;
  }
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
    return imageData;
  }

  // if not, convert it to the first supported format
  if (supports.includes("ImageBitmap") && imageData instanceof Blob) {
    return createImageBitmap(imageData);
  }
  if (supports.includes("OffscreenCanvas") && imageData instanceof Blob) {
    return await convertBlobToOffscreenCanvas(imageData);
  }
  if (supports.includes("ImageBitmap") && imageData instanceof OffscreenCanvas) {
    return imageData.transferToImageBitmap();
  }
  // if not, convert it to the first supported format
  if (supports.includes("ImageBitmap") && typeof imageData === "string") {
    return createImageBitmap(dataUriToBlob(imageData));
  }
  if (supports.includes("OffscreenCanvas") && typeof imageData === "string") {
    return convertBlobToOffscreenCanvas(dataUriToBlob(imageData));
  }
  if (supports.includes("Blob") && typeof imageData === "string") {
    return dataUriToBlob(imageData);
  }
  if (
    supports.includes("DataUri") &&
    typeof imageData === "string" &&
    imageData.startsWith("data:")
  ) {
    return imageData;
  }
  throw new Error(`Unsupported image data type: ${typeof imageData} `);
}
