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
export { getGpuDevice, resetGpuDeviceForTests } from "./media/gpuDevice.browser";
export { createTexturePool, getTexturePool, resetTexturePoolForTests } from "./media/texturePool.browser";
export type { TexturePool, TexturePoolOptions } from "./media/texturePool.browser";
export { createShaderCache, getShaderCache, SHADER_SRC } from "./media/shaderRegistry.browser";
export type { ShaderCache, ShaderName } from "./media/shaderRegistry.browser";
export { WebGpuImage } from "./media/webGpuImage.browser";
export type { ApplyParams } from "./media/webGpuImage.browser";

import "./media/imageHydrationResolver";
import "./media/imageCacheCodec";
import { CpuImage as _CpuImage } from "./media/cpuImage";
import { WebGpuImage as _WebGpuImage } from "./media/webGpuImage.browser";
import { getGpuDevice as _getGpuDevice } from "./media/gpuDevice.browser";
import { getImageRasterCodec as _getImageRasterCodec } from "./media/imageRasterCodecRegistry";
import { registerGpuImageFactory as _registerGpuImageFactory } from "./media/gpuImage";
import type { ImageBinary as _ImageBinary } from "./media/imageTypes";

async function _preferGpu(bin: _ImageBinary) {
  const dev = await _getGpuDevice();
  return dev ? _WebGpuImage.fromImageBinary(bin) : _CpuImage.fromImageBinary(bin);
}

_registerGpuImageFactory("fromDataUri", async (dataUri: string) => {
  const bin = await _getImageRasterCodec().decodeDataUri(dataUri);
  return _preferGpu(bin);
});

_registerGpuImageFactory("fromBlob", async (blob: Blob) => {
  const bitmap = await createImageBitmap(blob);
  const off = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("fromBlob: could not acquire 2D context");
  ctx.drawImage(bitmap, 0, 0);
  const id = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return _preferGpu({ data: id.data, width: bitmap.width, height: bitmap.height, channels: 4 });
});

_registerGpuImageFactory("fromImageBitmap", async (bitmap: ImageBitmap) => {
  const off = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("fromImageBitmap: could not acquire 2D context");
  ctx.drawImage(bitmap, 0, 0);
  const id = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return _preferGpu({ data: id.data, width: bitmap.width, height: bitmap.height, channels: 4 });
});
