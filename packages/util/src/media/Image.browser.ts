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

declare module "./Image" {
  interface Image {
    getImageData(): Promise<ImageData>;
    getImageBitmap(): Promise<ImageBitmap>;
    getVideoFrame(): Promise<VideoFrame>;
    getOffscreenCanvas(): Promise<OffscreenCanvas>;
  }
  namespace Image {
    function fromBitmap(bitmap: ImageBitmap): Image;
    function fromVideoFrame(frame: VideoFrame): Image;
    function fromOffscreenCanvas(canvas: OffscreenCanvas): Image;
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

Image.prototype.getImageData = async function getImageData(this: Image): Promise<ImageData> {
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
  return undefined;
};
