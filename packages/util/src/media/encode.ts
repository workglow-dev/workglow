/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { ImageBinary } from "./imageTypes";
import { getImageRasterCodec } from "./imageRasterCodecRegistry";

export async function encodeImageBinaryToPng(bin: ImageBinary): Promise<Uint8Array> {
  const dataUri = await getImageRasterCodec().encodeDataUri(bin, "image/png");
  const b64 = dataUri.slice(dataUri.indexOf(",") + 1);
  const decoded = atob(b64);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

export async function imageBinaryToBase64Png(bin: ImageBinary): Promise<string> {
  const dataUri = await getImageRasterCodec().encodeDataUri(bin, "image/png");
  return dataUri.slice(dataUri.indexOf(",") + 1);
}

export async function imageBinaryToDataUri(bin: ImageBinary, mimeType = "image/png"): Promise<string> {
  return getImageRasterCodec().encodeDataUri(bin, mimeType);
}

export async function imageBinaryToBlob(bin: ImageBinary, mimeType = "image/png"): Promise<Blob> {
  const bytes = await encodeImageBinaryToPng(bin);
  return new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
}
