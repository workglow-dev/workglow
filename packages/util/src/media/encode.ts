/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { RawPixelBuffer } from "./rawPixelBuffer";
import { getImageRasterCodec } from "./imageRasterCodecRegistry";

async function encodeImageBinaryBytes(bin: RawPixelBuffer, mimeType: string): Promise<Uint8Array> {
  const dataUri = await getImageRasterCodec().encodeDataUri(bin, mimeType);
  const b64 = dataUri.slice(dataUri.indexOf(",") + 1);
  const decoded = atob(b64);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

export async function encodeImageBinaryToPng(bin: RawPixelBuffer): Promise<Uint8Array> {
  return encodeImageBinaryBytes(bin, "image/png");
}

export async function imageBinaryToBase64Png(bin: RawPixelBuffer): Promise<string> {
  const dataUri = await getImageRasterCodec().encodeDataUri(bin, "image/png");
  return dataUri.slice(dataUri.indexOf(",") + 1);
}

export async function imageBinaryToDataUri(bin: RawPixelBuffer, mimeType = "image/png"): Promise<string> {
  return getImageRasterCodec().encodeDataUri(bin, mimeType);
}

export async function imageBinaryToBlob(bin: RawPixelBuffer, mimeType = "image/png"): Promise<Blob> {
  const bytes = await encodeImageBinaryBytes(bin, mimeType);
  return new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
}
