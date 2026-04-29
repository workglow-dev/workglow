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
export async function getGpuDevice(): Promise<null> {
  return null;
}
export function resetGpuDeviceForTests(): void {}
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
// WebGpuImage is browser-only at runtime; type-only re-export lets
// browser-targeted filter files (*.webgpu.ts) type-check under node tsc.
export { SharpImage } from "./media/sharpImage.node";
export type { ApplyParams, WebGpuImage } from "./media/webGpuImage.browser";

import { registerGpuImageFactory as _registerGpuImageFactory } from "./media/gpuImage";
import "./media/imageCacheCodec";
import "./media/imageHydrationResolver";
import { getImageRasterCodec as _getImageRasterCodec } from "./media/imageRasterCodecRegistry";
import { SharpImage as _SharpImage } from "./media/sharpImage.node";

_registerGpuImageFactory("fromImageBinaryAsync", (bin) => _SharpImage.fromImageBinary(bin));

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
