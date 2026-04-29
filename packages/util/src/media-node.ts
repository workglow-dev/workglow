/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export * from "./media/imageTypes";
export * from "./media/color";
export * from "./media/imageRasterCodecRegistry";
export * from "./media/MediaRawImage";
export type { GpuImage, GpuImageBackend, GpuImageEncodeFormat, GpuImageStatic } from "./media/gpuImage";
export { GpuImage as GpuImageFactory, registerGpuImageFactory } from "./media/gpuImage";
export { GpuImageSchema } from "./media/gpuImageSchema";
export { CpuImage } from "./media/cpuImage";
export { encodeImageBinaryToPng, imageBinaryToBase64Png, imageBinaryToDataUri, imageBinaryToBlob } from "./media/encode";
export { getPreviewBudget, setPreviewBudget, previewSource, registerPreviewResizeFn } from "./media/previewBudget";
export async function getGpuDevice(): Promise<null> { return null; }
export function resetGpuDeviceForTests(): void {}
export { createTexturePool, getTexturePool, resetTexturePoolForTests } from "./media/texturePool.browser";
export type { TexturePool, TexturePoolOptions } from "./media/texturePool.browser";
export { createShaderCache, getShaderCache, SHADER_SRC } from "./media/shaderRegistry.browser";
export type { ShaderCache, ShaderName } from "./media/shaderRegistry.browser";
// WebGpuImage is browser-only at runtime; type-only re-export lets
// browser-targeted filter files (*.webgpu.ts) type-check under node tsc.
export type { WebGpuImage, ApplyParams } from "./media/webGpuImage.browser";
export { SharpImage } from "./media/sharpImage.node";

import "./media/imageHydrationResolver";
import "./media/imageCacheCodec";
import { SharpImage as _SharpImage } from "./media/sharpImage.node";
import { getImageRasterCodec as _getImageRasterCodec } from "./media/imageRasterCodecRegistry";
import { registerGpuImageFactory as _registerGpuImageFactory } from "./media/gpuImage";

_registerGpuImageFactory("fromDataUri", async (dataUri: string) => {
  const bin = await _getImageRasterCodec().decodeDataUri(dataUri);
  return _SharpImage.fromImageBinary(bin);
});

_registerGpuImageFactory("fromBlob", async (blob: Blob) => {
  const buf = Buffer.from(await blob.arrayBuffer());
  return _SharpImage.fromBuffer(buf);
});

// fromImageBitmap is intentionally not registered in node — ImageBitmap doesn't
// exist there. The Proxy throws if a caller attempts it (the third test asserts this).
