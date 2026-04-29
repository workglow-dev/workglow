/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "./media/imageCacheCodec";
import "./media/imageHydrationResolver";

export * from "./media/color";
export { CpuImage } from "./media/cpuImage";
export {
  encodeImageBinaryToPng,
  imageBinaryToBase64Png,
  imageBinaryToBlob,
  imageBinaryToDataUri,
} from "./media/encode";
export {
  _resetFilterRegistryForTests,
  applyFilter,
  hasFilterOp,
  registerFilterOp,
} from "./media/filterRegistry";
export type { FilterOpFn } from "./media/filterRegistry";
export { getGpuDevice, resetGpuDeviceForTests } from "./media/gpuDevice.browser";
export {
  getGpuImageFactory,
  GpuImage as GpuImageFactory,
  registerGpuImageFactory,
} from "./media/gpuImage";
export type {
  GpuImage,
  GpuImageBackend,
  GpuImageEncodeFormat,
  GpuImageStatic,
} from "./media/gpuImage";
export { GpuImageSchema } from "./media/gpuImageSchema";
export * from "./media/imageRasterCodecRegistry";
export * from "./media/imageTypes";
export * from "./media/MediaRawImage";
export {
  getPreviewBudget,
  previewSource,
  registerPreviewResizeFn,
  setPreviewBudget,
} from "./media/previewBudget";
export {
  createShaderCache,
  getShaderCache,
  PASSTHROUGH_SHADER_SRC,
  VERTEX_PRELUDE,
} from "./media/shaderRegistry.browser";
export type { ShaderCache } from "./media/shaderRegistry.browser";
export {
  createTexturePool,
  getTexturePool,
  resetTexturePoolForTests,
} from "./media/texturePool.browser";
export type { TexturePool, TexturePoolOptions } from "./media/texturePool.browser";
export { WebGpuImage } from "./media/webGpuImage.browser";
export type { ApplyParams } from "./media/webGpuImage.browser";

import { CpuImage as _CpuImage } from "./media/cpuImage";
import { getGpuDevice as _getGpuDevice } from "./media/gpuDevice.browser";
import { registerGpuImageFactory as _registerGpuImageFactory } from "./media/gpuImage";
import { getImageRasterCodec as _getImageRasterCodec } from "./media/imageRasterCodecRegistry";
import type { ImageBinary as _ImageBinary } from "./media/imageTypes";
import { WebGpuImage as _WebGpuImage } from "./media/webGpuImage.browser";

async function _preferGpu(bin: _ImageBinary) {
  const dev = await _getGpuDevice();
  return dev ? _WebGpuImage.fromImageBinary(bin) : _CpuImage.fromImageBinary(bin);
}

_registerGpuImageFactory("fromImageBinaryAsync", _preferGpu);

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
