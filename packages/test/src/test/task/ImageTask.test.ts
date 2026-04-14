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
  ImageWatermarkTask,
} from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import type { ImageBinary } from "@workglow/util/media";
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

/** Minimal valid 1×1 RGB PNG (sharp-generated), as data URI. */
const PNG_1X1_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVR4nGPgEpEDAABoAD1UCKP3AAAAAElFTkSuQmCC";

describe("ImageTask", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  describe("Image input / output transport", () => {
    test("returns a data URI when input image is a data URI", async () => {
      const task = new ImageInvertTask();
      const result = await task.run({ image: PNG_1X1_DATA_URI });
      expect(typeof result.image).toBe("string");
      expect(result.image).toMatch(/^data:image\/png;base64,/);
    });

    test("returns ImageBinary when input image is ImageBinary", async () => {
      const image = createTestImage(1, 1, 3, [0, 0, 0]);
      const task = new ImageInvertTask();
      const result = await task.run({ image });
      expect(typeof result.image).toBe("object");
      expect(result.image).toMatchObject({ width: 1, height: 1, channels: 3 });
      expect(getPixel(result.image as ImageBinary, 0, 0)).toEqual([255, 255, 255]);
    });
  });

  describe("ImageResizeTask", () => {
    test("upscales a 2x2 image to 4x4", async () => {
      const image = createTestImage(2, 2, 3, [100, 150, 200]);
      const task = new ImageResizeTask();
      const result = (await task.run({ image, width: 4, height: 4 })) as { image: ImageBinary };
      expect(result.image.width).toBe(4);
      expect(result.image.height).toBe(4);
      expect(result.image.channels).toBe(3);
      expect(result.image.data.length).toBe(4 * 4 * 3);
    });

    test("downscales a 4x4 image to 2x2", async () => {
      const image = createTestImage(4, 4, 3, [80, 120, 160]);
      const task = new ImageResizeTask();
      const result = (await task.run({ image, width: 2, height: 2 })) as { image: ImageBinary };
      expect(result.image.width).toBe(2);
      expect(result.image.height).toBe(2);
    });
  });

  describe("ImageCropTask", () => {
    test("crops a rectangular region", async () => {
      const image = createTestImage(4, 4, 3, [100, 150, 200]);
      const task = new ImageCropTask();
      const result = (await task.run({ image, x: 1, y: 1, width: 2, height: 2 })) as {
        image: ImageBinary;
      };
      expect(result.image.width).toBe(2);
      expect(result.image.height).toBe(2);
      expect(result.image.channels).toBe(3);
    });

    test("clamps crop to image bounds", async () => {
      const image = createTestImage(4, 4, 3, [100, 150, 200]);
      const task = new ImageCropTask();
      const result = (await task.run({ image, x: 3, y: 3, width: 10, height: 10 })) as {
        image: ImageBinary;
      };
      expect(result.image.width).toBe(1);
      expect(result.image.height).toBe(1);
    });
  });

  describe("ImageRotateTask", () => {
    test("rotates 90 degrees", async () => {
      // 2x3 image -> 3x2
      const image = createTestImage(2, 3, 1);
      // Set distinct pixel values
      for (let i = 0; i < 6; i++) image.data[i] = i * 40;
      const task = new ImageRotateTask();
      const result = (await task.run({ image, angle: 90 })) as { image: ImageBinary };
      expect(result.image.width).toBe(3);
      expect(result.image.height).toBe(2);
    });

    test("rotates 180 degrees preserves dimensions", async () => {
      const image = createTestImage(3, 4, 1);
      for (let i = 0; i < 12; i++) image.data[i] = i * 20;
      const task = new ImageRotateTask();
      const result = (await task.run({ image, angle: 180 })) as { image: ImageBinary };
      expect(result.image.width).toBe(3);
      expect(result.image.height).toBe(4);
      // First pixel of original should be last pixel of rotated
      expect(result.image.data[11]).toBe(0);
      expect(result.image.data[0]).toBe(image.data[11]);
    });

    test("rotates 270 degrees", async () => {
      const image = createTestImage(2, 3, 1);
      const task = new ImageRotateTask();
      const result = (await task.run({ image, angle: 270 })) as { image: ImageBinary };
      expect(result.image.width).toBe(3);
      expect(result.image.height).toBe(2);
    });
  });

  describe("ImageFlipTask", () => {
    test("flips horizontally", async () => {
      const image = createTestImage(3, 1, 1);
      image.data[0] = 10;
      image.data[1] = 20;
      image.data[2] = 30;
      const task = new ImageFlipTask();
      const result = (await task.run({ image, direction: "horizontal" })) as { image: ImageBinary };
      expect(result.image.data[0]).toBe(30);
      expect(result.image.data[1]).toBe(20);
      expect(result.image.data[2]).toBe(10);
    });

    test("flips vertically", async () => {
      const image = createTestImage(1, 3, 1);
      image.data[0] = 10;
      image.data[1] = 20;
      image.data[2] = 30;
      const task = new ImageFlipTask();
      const result = (await task.run({ image, direction: "vertical" })) as { image: ImageBinary };
      expect(result.image.data[0]).toBe(30);
      expect(result.image.data[1]).toBe(20);
      expect(result.image.data[2]).toBe(10);
    });
  });

  describe("ImageGrayscaleTask", () => {
    test("converts RGB to grayscale", async () => {
      const image = createTestImage(2, 2, 3, [255, 0, 0]); // pure red
      const task = new ImageGrayscaleTask();
      const result = (await task.run({ image })) as { image: ImageBinary };
      expect(result.image.channels).toBe(1);
      expect(result.image.data.length).toBe(4);
      // Red luminance: (255*77) >> 8 = 76
      expect(result.image.data[0]).toBe(76);
    });

    test("passes through 1-channel image", async () => {
      const image = createTestImage(2, 2, 1, [128]);
      const task = new ImageGrayscaleTask();
      const result = (await task.run({ image })) as { image: ImageBinary };
      expect(result.image.channels).toBe(1);
      expect(result.image.data[0]).toBe(128);
    });
  });

  describe("ImageBorderTask", () => {
    test("adds a border of correct size", async () => {
      const image = createTestImage(4, 4, 3, [100, 100, 100]);
      const task = new ImageBorderTask();
      const result = (await task.run({
        image,
        borderWidth: 2,
        color: { r: 255, g: 0, b: 0 },
      })) as { image: ImageBinary };
      expect(result.image.width).toBe(8);
      expect(result.image.height).toBe(8);
      expect(result.image.channels).toBe(4);
      // Top-left corner should be the border color (red)
      const corner = getPixel(result.image, 0, 0);
      expect(corner[0]).toBe(255);
      expect(corner[1]).toBe(0);
      expect(corner[2]).toBe(0);
    });
  });

  describe("ImageTransparencyTask", () => {
    test("sets opacity to 0.5 on opaque image", async () => {
      const image = createTestImage(2, 2, 3, [100, 150, 200]);
      const task = new ImageTransparencyTask();
      const result = (await task.run({ image, opacity: 0.5 })) as { image: ImageBinary };
      expect(result.image.channels).toBe(4);
      // Alpha should be approximately 128 (255 * 0.5)
      expect(result.image.data[3]).toBeGreaterThan(125);
      expect(result.image.data[3]).toBeLessThan(130);
    });

    test("sets opacity to 0 makes fully transparent", async () => {
      const image = createTestImage(2, 2, 3, [100, 150, 200]);
      const task = new ImageTransparencyTask();
      const result = (await task.run({ image, opacity: 0 })) as { image: ImageBinary };
      expect(result.image.data[3]).toBe(0);
    });
  });

  describe("ImageBlurTask", () => {
    test("preserves dimensions", async () => {
      const image = createTestImage(8, 8, 3, [100, 150, 200]);
      const task = new ImageBlurTask();
      const result = (await task.run({ image, radius: 1 })) as { image: ImageBinary };
      expect(result.image.width).toBe(8);
      expect(result.image.height).toBe(8);
      expect(result.image.channels).toBe(3);
    });

    test("solid color image stays the same", async () => {
      const image = createTestImage(4, 4, 1, [128]);
      const task = new ImageBlurTask();
      const result = (await task.run({ image, radius: 2 })) as { image: ImageBinary };
      for (let i = 0; i < result.image.data.length; i++) {
        expect(result.image.data[i]).toBe(128);
      }
    });
  });

  describe("ImageWatermarkTask", () => {
    test("preserves dimensions", async () => {
      const image = createTestImage(64, 64, 3, [100, 100, 100]);
      const task = new ImageWatermarkTask();
      const result = (await task.run({
        image,
        spacing: 16,
        opacity: 0.3,
        pattern: "diagonal-lines",
      })) as { image: ImageBinary };
      expect(result.image.width).toBe(64);
      expect(result.image.height).toBe(64);
      expect(result.image.channels).toBe(4);
    });

    test("modifies some pixels", async () => {
      const image = createTestImage(32, 32, 3, [100, 100, 100]);
      const task = new ImageWatermarkTask();
      const result = (await task.run({
        image,
        spacing: 8,
        opacity: 0.5,
        pattern: "grid",
      })) as { image: ImageBinary };
      // At least some pixels should differ from source due to watermark
      let hasModified = false;
      for (let i = 0; i < result.image.data.length; i += 4) {
        if (result.image.data[i] !== 100) {
          hasModified = true;
          break;
        }
      }
      expect(hasModified).toBe(true);
    });
  });

  describe("ImagePixelateTask", () => {
    test("preserves dimensions", async () => {
      const image = createTestImage(8, 8, 3, [100, 150, 200]);
      const task = new ImagePixelateTask();
      const result = (await task.run({ image, blockSize: 4 })) as { image: ImageBinary };
      expect(result.image.width).toBe(8);
      expect(result.image.height).toBe(8);
    });

    test("pixels within a block are uniform", async () => {
      // Create image with varying pixels
      const image = createTestImage(4, 4, 1);
      for (let i = 0; i < 16; i++) image.data[i] = i * 16;
      const task = new ImagePixelateTask();
      const result = (await task.run({ image, blockSize: 2 })) as { image: ImageBinary };
      // Top-left 2x2 block should all be the same value
      expect(result.image.data[0]).toBe(result.image.data[1]);
      expect(result.image.data[0]).toBe(result.image.data[4]);
      expect(result.image.data[0]).toBe(result.image.data[5]);
    });
  });

  describe("ImageInvertTask", () => {
    test("inverts black to white", async () => {
      const image = createTestImage(1, 1, 3, [0, 0, 0]);
      const task = new ImageInvertTask();
      const result = (await task.run({ image })) as { image: ImageBinary };
      expect(getPixel(result.image, 0, 0)).toEqual([255, 255, 255]);
    });

    test("inverts RGB values", async () => {
      const image = createTestImage(1, 1, 3, [255, 128, 0]);
      const task = new ImageInvertTask();
      const result = (await task.run({ image })) as { image: ImageBinary };
      expect(getPixel(result.image, 0, 0)).toEqual([0, 127, 255]);
    });

    test("preserves alpha channel", async () => {
      const image = createTestImage(1, 1, 4, [100, 150, 200, 50]);
      const task = new ImageInvertTask();
      const result = (await task.run({ image })) as { image: ImageBinary };
      expect(getPixel(result.image, 0, 0)).toEqual([155, 105, 55, 50]);
    });
  });

  describe("ImageBrightnessTask", () => {
    test("increases brightness", async () => {
      const image = createTestImage(1, 1, 3, [100, 100, 100]);
      const task = new ImageBrightnessTask();
      const result = (await task.run({ image, amount: 50 })) as { image: ImageBinary };
      expect(getPixel(result.image, 0, 0)).toEqual([150, 150, 150]);
    });

    test("clamps at 255", async () => {
      const image = createTestImage(1, 1, 3, [200, 200, 200]);
      const task = new ImageBrightnessTask();
      const result = (await task.run({ image, amount: 100 })) as { image: ImageBinary };
      expect(getPixel(result.image, 0, 0)).toEqual([255, 255, 255]);
    });

    test("decreases brightness", async () => {
      const image = createTestImage(1, 1, 3, [100, 100, 100]);
      const task = new ImageBrightnessTask();
      const result = (await task.run({ image, amount: -50 })) as { image: ImageBinary };
      expect(getPixel(result.image, 0, 0)).toEqual([50, 50, 50]);
    });
  });

  describe("ImageContrastTask", () => {
    test("zero amount is identity", async () => {
      const image = createTestImage(1, 1, 3, [100, 150, 200]);
      const task = new ImageContrastTask();
      const result = (await task.run({ image, amount: 0 })) as { image: ImageBinary };
      expect(getPixel(result.image, 0, 0)).toEqual([100, 150, 200]);
    });

    test("positive contrast increases difference from 128", async () => {
      const image = createTestImage(1, 1, 3, [64, 128, 192]);
      const task = new ImageContrastTask();
      const result = (await task.run({ image, amount: 50 })) as { image: ImageBinary };
      const pixel = getPixel(result.image, 0, 0);
      expect(pixel[0]).toBeLessThan(64);
      expect(pixel[1]).toBe(128);
      expect(pixel[2]).toBeGreaterThan(192);
    });
  });

  describe("ImageSepiaTask", () => {
    test("transforms white pixel to sepia", async () => {
      const image = createTestImage(1, 1, 3, [255, 255, 255]);
      const task = new ImageSepiaTask();
      const result = (await task.run({ image })) as { image: ImageBinary };
      const pixel = getPixel(result.image, 0, 0);
      // Sepia white: R and G clamp to 255, B is lower
      expect(pixel[0]).toBeGreaterThanOrEqual(pixel[1]);
      expect(pixel[1]).toBeGreaterThan(pixel[2]);
    });

    test("preserves alpha", async () => {
      const image = createTestImage(1, 1, 4, [100, 100, 100, 50]);
      const task = new ImageSepiaTask();
      const result = (await task.run({ image })) as { image: ImageBinary };
      expect(result.image.data[3]).toBe(50);
    });
  });

  describe("ImageThresholdTask", () => {
    test("values above threshold become white", async () => {
      const image = createTestImage(1, 1, 1, [200]);
      const task = new ImageThresholdTask();
      const result = (await task.run({ image, threshold: 128 })) as { image: ImageBinary };
      expect(result.image.channels).toBe(1);
      expect(result.image.data[0]).toBe(255);
    });

    test("values below threshold become black", async () => {
      const image = createTestImage(1, 1, 1, [50]);
      const task = new ImageThresholdTask();
      const result = (await task.run({ image, threshold: 128 })) as { image: ImageBinary };
      expect(result.image.data[0]).toBe(0);
    });

    test("converts RGB to 1-channel", async () => {
      const image = createTestImage(2, 2, 3, [255, 255, 255]);
      const task = new ImageThresholdTask();
      const result = (await task.run({ image, threshold: 128 })) as { image: ImageBinary };
      expect(result.image.channels).toBe(1);
      expect(result.image.data.length).toBe(4);
    });
  });

  describe("ImagePosterizeTask", () => {
    test("2 levels produces binary values", async () => {
      const image = createTestImage(1, 1, 1, [100]);
      const task = new ImagePosterizeTask();
      const result = (await task.run({ image, levels: 2 })) as { image: ImageBinary };
      // 100 is closer to 0 than to 255 when step=255
      expect(result.image.data[0]).toBe(0);
    });

    test("2 levels on bright pixel", async () => {
      const image = createTestImage(1, 1, 1, [200]);
      const task = new ImagePosterizeTask();
      const result = (await task.run({ image, levels: 2 })) as { image: ImageBinary };
      expect(result.image.data[0]).toBe(255);
    });

    test("preserves alpha", async () => {
      const image = createTestImage(1, 1, 4, [100, 150, 200, 42]);
      const task = new ImagePosterizeTask();
      const result = (await task.run({ image, levels: 4 })) as { image: ImageBinary };
      expect(result.image.data[3]).toBe(42);
    });
  });

  describe("ImageTintTask", () => {
    test("amount 0 is identity", async () => {
      const image = createTestImage(1, 1, 3, [100, 150, 200]);
      const task = new ImageTintTask();
      const result = (await task.run({
        image,
        color: { r: 255, g: 0, b: 0 },
        amount: 0,
      })) as { image: ImageBinary };
      expect(getPixel(result.image, 0, 0)).toEqual([100, 150, 200]);
    });

    test("amount 1 produces tint color", async () => {
      const image = createTestImage(1, 1, 3, [100, 150, 200]);
      const task = new ImageTintTask();
      const result = (await task.run({
        image,
        color: { r: 255, g: 0, b: 0 },
        amount: 1,
      })) as { image: ImageBinary };
      expect(getPixel(result.image, 0, 0)).toEqual([255, 0, 0]);
    });

    test("preserves alpha", async () => {
      const image = createTestImage(1, 1, 4, [100, 150, 200, 42]);
      const task = new ImageTintTask();
      const result = (await task.run({
        image,
        color: { r: 255, g: 0, b: 0 },
        amount: 0.5,
      })) as { image: ImageBinary };
      expect(result.image.data[3]).toBe(42);
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

    test("outputs RGBA image with requested dimensions", async () => {
      const task = new ImageTextTask();
      const result = (await task.run({ ...base, position: "middle-center" })) as {
        image: ImageBinary;
      };
      expect(result.image.width).toBe(160);
      expect(result.image.height).toBe(160);
      expect(result.image.channels).toBe(4);
    });

    test("keeps a corner transparent when text is anchored bottom-right", async () => {
      const task = new ImageTextTask();
      const result = (await task.run({ ...base, position: "bottom-right" })) as {
        image: ImageBinary;
      };
      expect(getAlpha(result.image, 0, 0)).toBeLessThan(12);
    });

    test("top-left anchor places ink nearer the upper-left than bottom-right anchor", async () => {
      const task = new ImageTextTask();
      const tl = (await task.run({ ...base, position: "top-left" })) as { image: ImageBinary };
      const br = (await task.run({ ...base, position: "bottom-right" })) as { image: ImageBinary };
      const b1 = getAlphaBounds(tl.image);
      const b2 = getAlphaBounds(br.image);
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
      })) as { image: ImageBinary };
      const b = getAlphaBounds(result.image);
      expect(b).not.toBeNull();
      const px = getPixelWithHighestAlphaInBounds(result.image, b!);
      expect(px[0]).toBeGreaterThan(170);
      expect(px[1]).toBeLessThan(80);
      expect(px[2]).toBeLessThan(80);
    });

    test("larger font size paints more pixels than a smaller one", async () => {
      const task = new ImageTextTask();
      const small = (await task.run({ ...base, fontSize: 14, position: "middle-center" })) as {
        image: ImageBinary;
      };
      const large = (await task.run({ ...base, fontSize: 42, position: "middle-center" })) as {
        image: ImageBinary;
      };
      expect(countTextishPixels(large.image)).toBeGreaterThan(countTextishPixels(small.image));
    });

    test("renders onto an existing background image", async () => {
      const task = new ImageTextTask();
      const background = createTestImage(160, 160, 3, [40, 80, 120]);
      const result = (await task.run({
        ...base,
        image: background,
        position: "bottom-right",
      })) as { image: ImageBinary };

      expect(result.image.width).toBe(160);
      expect(result.image.height).toBe(160);
      expect(result.image.channels).toBe(4);
      expect(getPixel(result.image, 0, 0)).toEqual([40, 80, 120, 255]);
    });

    test("preserves data-uri output when background input is a data uri", async () => {
      const task = new ImageTextTask();
      const result = await task.run({
        ...base,
        image: PNG_1X1_DATA_URI,
        width: 1,
        height: 1,
        fontSize: 1,
        position: "top-left",
      });

      expect(typeof result.image).toBe("string");
      expect(result.image).toMatch(/^data:image\/png;base64,/);
    });
  });
});
