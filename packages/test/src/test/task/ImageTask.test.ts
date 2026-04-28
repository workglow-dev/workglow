/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ImageBlurTask,
  ImageBorderTask,
  ImageBrightnessTask,
  ImageContrastTask,
  ImageCropTask,
  ImageFlipTask,
  ImageGrayscaleTask,
  ImageInvertTask,
  ImagePixelateTask,
  ImagePosterizeTask,
  ImageResizeTask,
  ImageRotateTask,
  ImageSepiaTask,
  ImageTextTask,
  ImageThresholdTask,
  ImageTintTask,
  ImageTransparencyTask,
} from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { CpuImage, type GpuImage, type ImageBinary } from "@workglow/util/media";
import { describe, expect, test } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

function createTestImage(w: number, h: number, channels: 1 | 3 | 4, fill?: number[]): ImageBinary {
  const data = new Uint8ClampedArray(w * h * channels);
  if (fill) {
    for (let i = 0; i < w * h; i++) {
      for (let c = 0; c < channels; c++) {
        data[i * channels + c] = fill[c % fill.length];
      }
    }
  }
  return { data, width: w, height: h, channels };
}

function getPixel(image: ImageBinary, x: number, y: number): number[] {
  const idx = (y * image.width + x) * image.channels;
  const pixel: number[] = [];
  for (let c = 0; c < image.channels; c++) {
    pixel.push(image.data[idx + c]);
  }
  return pixel;
}

function getAlpha(image: ImageBinary, x: number, y: number): number {
  const idx = (y * image.width + x) * image.channels;
  return image.data[idx + 3] ?? 0;
}

function countTextishPixels(image: ImageBinary, alphaThreshold = 8): number {
  let n = 0;
  const ch = image.channels;
  for (let i = ch - 1; i < image.data.length; i += ch) {
    if ((image.data[i] ?? 0) > alphaThreshold) n++;
  }
  return n;
}

function getAlphaBounds(
  image: ImageBinary,
  alphaThreshold = 8
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const { width, height, data, channels } = image;
  if (channels !== 4) return null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3] ?? 0;
      if (a > alphaThreshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

function getPixelWithHighestAlphaInBounds(
  image: ImageBinary,
  b: { minX: number; minY: number; maxX: number; maxY: number }
): number[] {
  let bestA = -1;
  let bestX = b.minX;
  let bestY = b.minY;
  for (let y = b.minY; y <= b.maxY; y++) {
    for (let x = b.minX; x <= b.maxX; x++) {
      const a = getAlpha(image, x, y);
      if (a > bestA) {
        bestA = a;
        bestX = x;
        bestY = y;
      }
    }
  }
  return getPixel(image, bestX, bestY);
}

describe("ImageTask", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  describe("Image input / output transport", () => {
    test("returns a GpuImage when input image is a CpuImage (data URI skipped — new API is GpuImage)", async () => {
      const bin = createTestImage(1, 1, 3, [255, 255, 255]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageInvertTask();
      const result = await task.run({ image });
      expect(typeof result.image).toBe("object");
      const out = await (result.image as GpuImage).materialize();
      expect(out.width).toBe(1);
      expect(out.height).toBe(1);
    });

    test("returns GpuImage when input image is CpuImage", async () => {
      const bin = createTestImage(1, 1, 3, [0, 0, 0]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageInvertTask();
      const result = await task.run({ image });
      expect(typeof result.image).toBe("object");
      const out = await (result.image as GpuImage).materialize();
      expect(out.width).toBe(1);
      expect(out.height).toBe(1);
      expect(out.channels).toBe(3);
      expect(getPixel(out, 0, 0)).toEqual([255, 255, 255]);
    });
  });

  describe("ImageResizeTask", () => {
    test("upscales a 2x2 image to 4x4", async () => {
      const bin = createTestImage(2, 2, 3, [100, 150, 200]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageResizeTask();
      const result = (await task.run({ image, width: 4, height: 4 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.width).toBe(4);
      expect(out.height).toBe(4);
      expect(out.channels).toBe(3);
      expect(out.data.length).toBe(4 * 4 * 3);
    });

    test("downscales a 4x4 image to 2x2", async () => {
      const bin = createTestImage(4, 4, 3, [80, 120, 160]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageResizeTask();
      const result = (await task.run({ image, width: 2, height: 2 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.width).toBe(2);
      expect(out.height).toBe(2);
    });
  });

  describe("ImageCropTask", () => {
    test("crops a rectangular region", async () => {
      const bin = createTestImage(4, 4, 3, [100, 150, 200]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageCropTask();
      const result = (await task.run({ image, left: 1, top: 1, width: 2, height: 2 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.width).toBe(2);
      expect(out.height).toBe(2);
      expect(out.channels).toBe(3);
    });

    test("clamps crop to image bounds", async () => {
      const bin = createTestImage(4, 4, 3, [100, 150, 200]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageCropTask();
      const result = (await task.run({ image, left: 3, top: 3, width: 10, height: 10 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.width).toBe(1);
      expect(out.height).toBe(1);
    });
  });

  describe("ImageRotateTask", () => {
    test("rotates 90 degrees", async () => {
      const binSrc = createTestImage(2, 3, 1);
      for (let i = 0; i < 6; i++) binSrc.data[i] = i * 40;
      const image = CpuImage.fromImageBinary(binSrc) as unknown as GpuImage;
      const task = new ImageRotateTask();
      const result = (await task.run({ image, angle: 90 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.width).toBe(3);
      expect(out.height).toBe(2);
    });

    test("rotates 180 degrees preserves dimensions", async () => {
      const binSrc = createTestImage(3, 4, 1);
      for (let i = 0; i < 12; i++) binSrc.data[i] = i * 20;
      const image = CpuImage.fromImageBinary(binSrc) as unknown as GpuImage;
      const task = new ImageRotateTask();
      const result = (await task.run({ image, angle: 180 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.width).toBe(3);
      expect(out.height).toBe(4);
      expect(out.data[11]).toBe(0);
      expect(out.data[0]).toBe(binSrc.data[11]);
    });

    test("rotates 270 degrees", async () => {
      const binSrc = createTestImage(2, 3, 1);
      const image = CpuImage.fromImageBinary(binSrc) as unknown as GpuImage;
      const task = new ImageRotateTask();
      const result = (await task.run({ image, angle: 270 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.width).toBe(3);
      expect(out.height).toBe(2);
    });
  });

  describe("ImageFlipTask", () => {
    test("flips horizontally", async () => {
      const bin = createTestImage(3, 1, 1);
      bin.data[0] = 10;
      bin.data[1] = 20;
      bin.data[2] = 30;
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageFlipTask();
      const result = (await task.run({ image, direction: "horizontal" })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.data[0]).toBe(30);
      expect(out.data[1]).toBe(20);
      expect(out.data[2]).toBe(10);
    });

    test("flips vertically", async () => {
      const bin = createTestImage(1, 3, 1);
      bin.data[0] = 10;
      bin.data[1] = 20;
      bin.data[2] = 30;
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageFlipTask();
      const result = (await task.run({ image, direction: "vertical" })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.data[0]).toBe(30);
      expect(out.data[1]).toBe(20);
      expect(out.data[2]).toBe(10);
    });
  });

  describe("ImageGrayscaleTask", () => {
    test("converts RGB to 4-channel grayscale with replicated luma", async () => {
      const bin = createTestImage(2, 2, 3, [255, 0, 0]); // pure red
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageGrayscaleTask();
      const result = (await task.run({ image })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.channels).toBe(4);
      expect(out.data.length).toBe(2 * 2 * 4);
      // Red luminance: (255*77) >> 8 = 76; alpha defaults to 255 for RGB input.
      expect(getPixel(out, 0, 0)).toEqual([76, 76, 76, 255]);
    });

    test("expands 1-channel image to 4-channel grayscale with full alpha", async () => {
      const bin = createTestImage(2, 2, 1, [128]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageGrayscaleTask();
      const result = (await task.run({ image })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.channels).toBe(4);
      expect(getPixel(out, 0, 0)).toEqual([128, 128, 128, 255]);
    });

    test("preserves alpha channel from RGBA input", async () => {
      const bin = createTestImage(1, 1, 4, [200, 100, 50, 42]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageGrayscaleTask();
      const result = (await task.run({ image })) as { image: GpuImage };
      const out = await result.image.materialize();
      // (200*77 + 100*150 + 50*29) >> 8 = 124
      expect(out.channels).toBe(4);
      expect(getPixel(out, 0, 0)).toEqual([124, 124, 124, 42]);
    });
  });

  describe("ImageBorderTask", () => {
    test("adds a border of correct size", async () => {
      const bin = createTestImage(4, 4, 3, [100, 100, 100]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageBorderTask();
      const result = (await task.run({
        image,
        borderWidth: 2,
        color: { r: 255, g: 0, b: 0 },
      })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.width).toBe(8);
      expect(out.height).toBe(8);
      expect(out.channels).toBe(4);
      const corner = getPixel(out, 0, 0);
      expect(corner[0]).toBe(255);
      expect(corner[1]).toBe(0);
      expect(corner[2]).toBe(0);
    });
  });

  describe("ImageTransparencyTask", () => {
    test("sets opacity to 0.5 on opaque image", async () => {
      const bin = createTestImage(2, 2, 3, [100, 150, 200]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageTransparencyTask();
      const result = (await task.run({ image, amount: 0.5 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.channels).toBe(4);
      // Alpha should be approximately 128 (255 * 0.5)
      expect(out.data[3]).toBeGreaterThan(125);
      expect(out.data[3]).toBeLessThan(130);
    });

    test("sets opacity to 0 makes fully transparent", async () => {
      const bin = createTestImage(2, 2, 3, [100, 150, 200]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageTransparencyTask();
      const result = (await task.run({ image, amount: 0 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.data[3]).toBe(0);
    });
  });

  describe("ImageBlurTask", () => {
    test("preserves dimensions", async () => {
      const bin = createTestImage(8, 8, 3, [100, 150, 200]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageBlurTask();
      const result = (await task.run({ image, radius: 1 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.width).toBe(8);
      expect(out.height).toBe(8);
      expect(out.channels).toBe(3);
    });

    test("solid color image stays the same", async () => {
      const bin = createTestImage(4, 4, 1, [128]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageBlurTask();
      const result = (await task.run({ image, radius: 2 })) as { image: GpuImage };
      const out = await result.image.materialize();
      for (let i = 0; i < out.data.length; i++) {
        expect(out.data[i]).toBe(128);
      }
    });
  });

  describe("ImagePixelateTask", () => {
    test("preserves dimensions", async () => {
      const bin = createTestImage(8, 8, 3, [100, 150, 200]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImagePixelateTask();
      const result = (await task.run({ image, blockSize: 4 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.width).toBe(8);
      expect(out.height).toBe(8);
    });

    test("pixels within a block are uniform", async () => {
      const bin = createTestImage(4, 4, 1);
      for (let i = 0; i < 16; i++) bin.data[i] = i * 16;
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImagePixelateTask();
      const result = (await task.run({ image, blockSize: 2 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.data[0]).toBe(out.data[1]);
      expect(out.data[0]).toBe(out.data[4]);
      expect(out.data[0]).toBe(out.data[5]);
    });
  });

  describe("ImageInvertTask", () => {
    test("inverts black to white", async () => {
      const bin = createTestImage(1, 1, 3, [0, 0, 0]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageInvertTask();
      const result = (await task.run({ image })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(getPixel(out, 0, 0)).toEqual([255, 255, 255]);
    });

    test("inverts RGB values", async () => {
      const bin = createTestImage(1, 1, 3, [255, 128, 0]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageInvertTask();
      const result = (await task.run({ image })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(getPixel(out, 0, 0)).toEqual([0, 127, 255]);
    });

    test("preserves alpha channel", async () => {
      const bin = createTestImage(1, 1, 4, [100, 150, 200, 50]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageInvertTask();
      const result = (await task.run({ image })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(getPixel(out, 0, 0)).toEqual([155, 105, 55, 50]);
    });
  });

  describe("ImageBrightnessTask", () => {
    test("increases brightness", async () => {
      const bin = createTestImage(1, 1, 3, [100, 100, 100]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageBrightnessTask();
      const result = (await task.run({ image, amount: 50 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(getPixel(out, 0, 0)).toEqual([150, 150, 150]);
    });

    test("clamps at 255", async () => {
      const bin = createTestImage(1, 1, 3, [200, 200, 200]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageBrightnessTask();
      const result = (await task.run({ image, amount: 100 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(getPixel(out, 0, 0)).toEqual([255, 255, 255]);
    });

    test("decreases brightness", async () => {
      const bin = createTestImage(1, 1, 3, [100, 100, 100]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageBrightnessTask();
      const result = (await task.run({ image, amount: -50 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(getPixel(out, 0, 0)).toEqual([50, 50, 50]);
    });
  });

  describe("ImageContrastTask", () => {
    test("zero amount is identity", async () => {
      const bin = createTestImage(1, 1, 3, [100, 150, 200]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageContrastTask();
      const result = (await task.run({ image, amount: 0 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(getPixel(out, 0, 0)).toEqual([100, 150, 200]);
    });

    test("positive contrast increases difference from 128", async () => {
      const bin = createTestImage(1, 1, 3, [64, 128, 192]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageContrastTask();
      const result = (await task.run({ image, amount: 50 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.data[0]).toBeLessThan(64);
      expect(out.data[1]).toBe(128);
      expect(out.data[2]).toBeGreaterThan(192);
    });
  });

  describe("ImageSepiaTask", () => {
    test("transforms white pixel to sepia", async () => {
      const bin = createTestImage(1, 1, 3, [255, 255, 255]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageSepiaTask();
      const result = (await task.run({ image })) as { image: GpuImage };
      const out = await result.image.materialize();
      const pixel = getPixel(out, 0, 0);
      // Sepia white: R and G clamp to 255, B is lower
      expect(pixel[0]).toBeGreaterThanOrEqual(pixel[1]!);
      expect(pixel[1]).toBeGreaterThan(pixel[2]!);
    });

    test("preserves alpha", async () => {
      const bin = createTestImage(1, 1, 4, [100, 100, 100, 50]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageSepiaTask();
      const result = (await task.run({ image })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.data[3]).toBe(50);
    });
  });

  describe("ImageThresholdTask", () => {
    test("values above threshold become white", async () => {
      const bin = createTestImage(1, 1, 1, [200]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageThresholdTask();
      const result = (await task.run({ image, value: 128 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.channels).toBe(1);
      expect(out.data[0]).toBe(255);
    });

    test("values below threshold become black", async () => {
      const bin = createTestImage(1, 1, 1, [50]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageThresholdTask();
      const result = (await task.run({ image, value: 128 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.data[0]).toBe(0);
    });

    test("applies threshold per channel on RGB image", async () => {
      const bin = createTestImage(1, 1, 3, [255, 50, 255]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageThresholdTask();
      const result = (await task.run({ image, value: 128 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.channels).toBe(3);
      expect(out.data[0]).toBe(255);
      expect(out.data[1]).toBe(0);
      expect(out.data[2]).toBe(255);
    });
  });

  describe("ImagePosterizeTask", () => {
    test("2 levels produces binary values", async () => {
      const bin = createTestImage(1, 1, 1, [100]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImagePosterizeTask();
      const result = (await task.run({ image, levels: 2 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.data[0]).toBe(0);
    });

    test("2 levels on bright pixel", async () => {
      const bin = createTestImage(1, 1, 1, [200]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImagePosterizeTask();
      const result = (await task.run({ image, levels: 2 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.data[0]).toBe(255);
    });

    test("preserves alpha", async () => {
      const bin = createTestImage(1, 1, 4, [100, 150, 200, 42]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImagePosterizeTask();
      const result = (await task.run({ image, levels: 4 })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.data[3]).toBe(42);
    });
  });

  describe("ImageTintTask", () => {
    test("amount 0 is identity", async () => {
      const bin = createTestImage(1, 1, 3, [100, 150, 200]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageTintTask();
      const result = (await task.run({
        image,
        color: { r: 255, g: 0, b: 0, a: 255 },
        amount: 0,
      })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(getPixel(out, 0, 0)).toEqual([100, 150, 200]);
    });

    test("amount 1 produces tint color", async () => {
      const bin = createTestImage(1, 1, 3, [100, 150, 200]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageTintTask();
      const result = (await task.run({
        image,
        color: { r: 255, g: 0, b: 0, a: 255 },
        amount: 1,
      })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(getPixel(out, 0, 0)).toEqual([255, 0, 0]);
    });

    test("preserves alpha", async () => {
      const bin = createTestImage(1, 1, 4, [100, 150, 200, 42]);
      const image = CpuImage.fromImageBinary(bin) as unknown as GpuImage;
      const task = new ImageTintTask();
      const result = (await task.run({
        image,
        color: { r: 255, g: 0, b: 0, a: 255 },
        amount: 0.5,
      })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.data[3]).toBe(42);
    });
  });

  describe("ImageTextTask", () => {
    const base = {
      text: "A",
      font: "sans-serif",
      fontSize: 36,
      bold: false,
      italic: false,
      color: { r: 20, g: 20, b: 20, a: 255 },
      width: 160,
      height: 160,
    } as const;
    const { width: _baseWidth, height: _baseHeight, ...baseWithBackground } = base;

    test("accepts the image branch without width and height", async () => {
      const task = new ImageTextTask();
      const bg = CpuImage.fromImageBinary(createTestImage(96, 64, 3, [40, 80, 120])) as unknown as GpuImage;

      const result = (await task.run({
        ...baseWithBackground,
        image: bg,
        position: "bottom-right",
      })) as { image: GpuImage };
      const out = await result.image.materialize();

      expect(out.width).toBe(96);
      expect(out.height).toBe(64);
    });

    test("accepts the explicit-dimensions branch without image", async () => {
      const task = new ImageTextTask();

      const result = (await task.run({
        ...base,
        width: 96,
        height: 64,
        position: "middle-center",
      })) as { image: GpuImage };
      const out = await result.image.materialize();

      expect(out.width).toBe(96);
      expect(out.height).toBe(64);
    });

    test("rejects missing both background image and explicit dimensions", async () => {
      const task = new ImageTextTask();

      await expect(
        task.run({
          ...baseWithBackground,
          position: "middle-center",
        })
      ).rejects.toThrow(/does not match schema/);
    });

    test("rejects zero font size", async () => {
      const task = new ImageTextTask();
      await expect(task.run({ ...base, fontSize: 0, position: "middle-center" })).rejects.toThrow(
        /does not match schema/
      );
    });

    test("rejects empty text", async () => {
      const task = new ImageTextTask();
      await expect(task.run({ ...base, text: "", position: "middle-center" })).rejects.toThrow(
        /does not match schema/
      );
    });

    test("outputs RGBA image with requested dimensions", async () => {
      const task = new ImageTextTask();
      const result = (await task.run({ ...base, position: "middle-center" })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(out.width).toBe(160);
      expect(out.height).toBe(160);
      expect(out.channels).toBe(4);
    });

    test("renders text into a transparent image when width and height are provided", async () => {
      const task = new ImageTextTask();
      const result = (await task.run({
        ...base,
        width: 96,
        height: 64,
        position: "middle-center",
      })) as { image: GpuImage };
      const out = await result.image.materialize();

      expect(out.width).toBe(96);
      expect(out.height).toBe(64);
      expect(out.channels).toBe(4);
      expect(getAlpha(out, 0, 0)).toBeLessThan(12);
    });

    test("keeps a corner transparent when text is anchored bottom-right", async () => {
      const task = new ImageTextTask();
      const result = (await task.run({ ...base, position: "bottom-right" })) as { image: GpuImage };
      const out = await result.image.materialize();
      expect(getAlpha(out, 0, 0)).toBeLessThan(12);
    });

    test("top-left anchor places ink nearer the upper-left than bottom-right anchor", async () => {
      const task = new ImageTextTask();
      const tlResult = (await task.run({ ...base, position: "top-left" })) as { image: GpuImage };
      const brResult = (await task.run({ ...base, position: "bottom-right" })) as { image: GpuImage };
      const tl = await tlResult.image.materialize();
      const br = await brResult.image.materialize();
      const b1 = getAlphaBounds(tl);
      const b2 = getAlphaBounds(br);
      expect(b1).not.toBeNull();
      expect(b2).not.toBeNull();
      const c1x = (b1!.minX + b1!.maxX) / 2;
      const c1y = (b1!.minY + b1!.maxY) / 2;
      const c2x = (b2!.minX + b2!.maxX) / 2;
      const c2y = (b2!.minY + b2!.maxY) / 2;
      expect(c1x + c1y).toBeLessThan(c2x + c2y);
    });

    test("uses text color in rendered pixels", async () => {
      const task = new ImageTextTask();
      const result = (await task.run({
        ...base,
        color: { r: 200, g: 10, b: 30, a: 255 },
        position: "middle-center",
      })) as { image: GpuImage };
      const out = await result.image.materialize();
      const b = getAlphaBounds(out);
      expect(b).not.toBeNull();
      const px = getPixelWithHighestAlphaInBounds(out, b!);
      expect(px[0]).toBeGreaterThan(170);
      expect(px[1]).toBeLessThan(80);
      expect(px[2]).toBeLessThan(80);
    });

    test("larger font size paints more pixels than a smaller one", async () => {
      const task = new ImageTextTask();
      const smallResult = (await task.run({ ...base, fontSize: 14, position: "middle-center" })) as { image: GpuImage };
      const largeResult = (await task.run({ ...base, fontSize: 42, position: "middle-center" })) as { image: GpuImage };
      const small = await smallResult.image.materialize();
      const large = await largeResult.image.materialize();
      expect(countTextishPixels(large)).toBeGreaterThan(countTextishPixels(small));
    });

    test("renders onto an existing background image", async () => {
      const task = new ImageTextTask();
      const bg = CpuImage.fromImageBinary(createTestImage(160, 160, 3, [40, 80, 120])) as unknown as GpuImage;
      const result = (await task.run({
        ...baseWithBackground,
        image: bg,
        position: "bottom-right",
      })) as { image: GpuImage };
      const out = await result.image.materialize();

      expect(out.width).toBe(160);
      expect(out.height).toBe(160);
      expect(out.channels).toBe(4);
      expect(getPixel(out, 0, 0)).toEqual([40, 80, 120, 255]);
    });

    test("renders text over a background image using the image dimensions", async () => {
      const task = new ImageTextTask();
      const bg = CpuImage.fromImageBinary(createTestImage(96, 64, 3, [40, 80, 120])) as unknown as GpuImage;
      const result = (await task.run({
        text: base.text,
        font: base.font,
        fontSize: base.fontSize,
        bold: base.bold,
        italic: base.italic,
        color: base.color,
        image: bg,
        position: "bottom-right",
      })) as { image: GpuImage };
      const out = await result.image.materialize();

      expect(out.width).toBe(96);
      expect(out.height).toBe(64);
      expect(out.channels).toBe(4);
      expect(getPixel(out, 0, 0)).toEqual([40, 80, 120, 255]);
    });
  });
});
