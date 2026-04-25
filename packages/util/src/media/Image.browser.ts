/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Browser-only augmentation of {@link Image}. Adds `getImageData`,
 * `getImageBitmap`, `getVideoFrame`, `getOffscreenCanvas`, and a private
 * helper `toFirstSupportedBrowser` consulted by the base `toFirstSupported`.
 */

import type { ImageBinary, ImageDataSupport } from "./imageTypes";
import { Image, dataUriToBlob } from "./Image";
import {
  downloadTextureToImageBinary,
  getCachedImageGpuDevice,
  getImageGpuDevice,
  isImageGpuSupported,
  uploadImageBinaryToTexture,
} from "./imageGpu";

declare module "./Image" {
  interface Image {
    getImageData(): Promise<ImageData>;
    getImageBitmap(): Promise<ImageBitmap>;
    getVideoFrame(): Promise<VideoFrame>;
    getOffscreenCanvas(): Promise<OffscreenCanvas>;
    /**
     * Materialize this image as a GPU texture. Uploads on first call; returns
     * the cached texture on subsequent calls. Throws if WebGPU isn't
     * available — callers should gate on `Image.isGpuSupported()` first.
     */
    getTexture(): Promise<unknown>;
  }
  namespace Image {
    function fromBitmap(bitmap: ImageBitmap): Image;
    function fromVideoFrame(frame: VideoFrame): Image;
    function fromOffscreenCanvas(canvas: OffscreenCanvas): Image;
    function isGpuSupported(): boolean;
  }
}

Image.fromBitmap = function fromBitmap(bitmap: ImageBitmap): Image {
  return Image.from(bitmap);
};
Image.fromVideoFrame = function fromVideoFrame(frame: VideoFrame): Image {
  return Image.from(frame);
};
Image.fromOffscreenCanvas = function fromOffscreenCanvas(canvas: OffscreenCanvas): Image {
  return Image.from(canvas);
};
Image.isGpuSupported = isImageGpuSupported;

function rasterToImageData(image: ImageBinary): ImageData {
  const { width, height, channels, data } = image;
  const id = new ImageData(width, height);
  if (channels === 4) {
    id.data.set(data);
    return id;
  }
  if (channels === 3) {
    for (let i = 0; i < width * height; i++) {
      id.data[i * 4] = data[i * 3]!;
      id.data[i * 4 + 1] = data[i * 3 + 1]!;
      id.data[i * 4 + 2] = data[i * 3 + 2]!;
      id.data[i * 4 + 3] = 255;
    }
    return id;
  }
  if (channels === 1) {
    for (let i = 0; i < width * height; i++) {
      const v = data[i]!;
      id.data[i * 4] = v;
      id.data[i * 4 + 1] = v;
      id.data[i * 4 + 2] = v;
      id.data[i * 4 + 3] = 255;
    }
    return id;
  }
  throw new Error(`Image.getImageData: unsupported channel count ${channels}`);
}

async function blobToOffscreenCanvas(blob: Blob): Promise<OffscreenCanvas> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image: failed to get 2D context on OffscreenCanvas");
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}

// Augment getPixels to materialize texture / bitmap / canvas / videoFrame
// sources without bouncing through dataUri (the base implementation throws
// for these).
const baseGetPixels = Image.prototype.getPixels;
Image.prototype.getPixels = async function getPixels(this: Image): Promise<ImageBinary> {
  const source = this.getSource();
  switch (source.kind) {
    case "texture": {
      const dev = (await getImageGpuDevice()) as unknown;
      if (!dev) {
        throw new Error("Image.getPixels: GPU device unavailable for texture source");
      }
      const pixels = await downloadTextureToImageBinary(
        dev,
        source.texture,
        source.width,
        source.height
      );
      this.setPixelsCache(pixels);
      return pixels;
    }
    case "bitmap":
    case "offscreenCanvas":
    case "videoFrame": {
      const id = await this.getImageData();
      const pixels: ImageBinary = {
        data: id.data,
        width: id.width,
        height: id.height,
        channels: 4,
      };
      this.setPixelsCache(pixels);
      return pixels;
    }
  }
  return baseGetPixels.call(this);
};

Image.prototype.getImageData = async function getImageData(this: Image): Promise<ImageData> {
  const source = this.getSource();
  // Fast-path: an OffscreenCanvas already has a 2D context; ask it directly
  // to avoid the bitmap → canvas → readback dance the generic path takes.
  if (source.kind === "offscreenCanvas") {
    const ctx = source.canvas.getContext("2d");
    if (ctx) return ctx.getImageData(0, 0, source.canvas.width, source.canvas.height);
  }
  if (source.kind === "bitmap") {
    const c = new OffscreenCanvas(source.bitmap.width, source.bitmap.height);
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Image.getImageData: failed to get 2D context");
    ctx.drawImage(source.bitmap, 0, 0);
    return ctx.getImageData(0, 0, source.bitmap.width, source.bitmap.height);
  }
  const pixels = await this.getPixels();
  return rasterToImageData(pixels);
};

Image.prototype.getImageBitmap = async function getImageBitmap(this: Image): Promise<ImageBitmap> {
  const source = this.getSource();
  if (source.kind === "bitmap") return source.bitmap;
  if (source.kind === "blob") return createImageBitmap(source.blob);
  if (source.kind === "offscreenCanvas") {
    return source.canvas.transferToImageBitmap();
  }
  if (source.kind === "dataUri") {
    return createImageBitmap(dataUriToBlob(source.dataUri));
  }
  const id = await this.getImageData();
  return createImageBitmap(id);
};

Image.prototype.getVideoFrame = async function getVideoFrame(this: Image): Promise<VideoFrame> {
  const source = this.getSource();
  if (source.kind === "videoFrame") return source.frame;
  const bitmap = await this.getImageBitmap();
  return new VideoFrame(bitmap, { timestamp: 0 });
};

Image.prototype.getOffscreenCanvas = async function getOffscreenCanvas(
  this: Image
): Promise<OffscreenCanvas> {
  const source = this.getSource();
  if (source.kind === "offscreenCanvas") return source.canvas;
  if (source.kind === "blob") return blobToOffscreenCanvas(source.blob);
  if (source.kind === "dataUri") return blobToOffscreenCanvas(dataUriToBlob(source.dataUri));
  const id = await this.getImageData();
  const canvas = new OffscreenCanvas(id.width, id.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image.getOffscreenCanvas: failed to get 2D context");
  ctx.putImageData(id, 0, 0);
  return canvas;
};

// Cached texture handle keyed off Image instance identity. Stored on a
// WeakMap so dropping the Image automatically frees the entry; the GPUTexture
// itself is freed when the device drops it (or is reaped via
// `device.destroy()` if the page tears down the GPU context).
const textureCache = new WeakMap<Image, unknown>();

Image.prototype.getTexture = async function getTexture(this: Image): Promise<unknown> {
  const source = this.getSource();
  if (source.kind === "texture") {
    return source.texture;
  }
  const cached = textureCache.get(this);
  if (cached) return cached;
  // Reach for the synchronous device handle first so the common steady-state
  // path (device already acquired by the previous task in the chain) doesn't
  // pay an extra microtask trip through `await getImageGpuDevice()`.
  const device = (getCachedImageGpuDevice() ?? (await getImageGpuDevice())) as unknown;
  if (!device) {
    throw new Error("Image.getTexture: WebGPU device unavailable");
  }
  const pixels = await this.getPixels();
  const tex = uploadImageBinaryToTexture(device, pixels);
  textureCache.set(this, tex);
  return tex;
};

// Internal hook used by base `toFirstSupported` for browser-only tokens.
(Image.prototype as unknown as {
  toFirstSupportedBrowser: (want: ImageDataSupport) => Promise<unknown>;
}).toFirstSupportedBrowser = async function toFirstSupportedBrowser(
  this: Image,
  want: ImageDataSupport
): Promise<unknown> {
  if (want === "ImageBitmap") return this.getImageBitmap();
  if (want === "VideoFrame") return this.getVideoFrame();
  if (want === "OffscreenCanvas") return this.getOffscreenCanvas();
  if (want === "GpuTexture") return this.getTexture();
  return undefined;
};
