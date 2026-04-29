/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CpuImage, type ImageBinary } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";

export interface PixelateParams { blockSize: number; }

function cpuPixelate(bin: ImageBinary, blockSize: number): ImageBinary {
  const { data: src, width, height, channels } = bin;
  const dst = new Uint8ClampedArray(src.length);

  for (let by = 0; by < height; by += blockSize) {
    const blockH = Math.min(blockSize, height - by);
    for (let bx = 0; bx < width; bx += blockSize) {
      const blockW = Math.min(blockSize, width - bx);
      const blockArea = blockW * blockH;

      const sums = new Array<number>(channels).fill(0);
      for (let y = by; y < by + blockH; y++) {
        for (let x = bx; x < bx + blockW; x++) {
          const idx = (y * width + x) * channels;
          for (let c = 0; c < channels; c++) {
            sums[c] += src[idx + c]!;
          }
        }
      }

      const avg = sums.map((s) => (s / blockArea + 0.5) | 0);

      for (let y = by; y < by + blockH; y++) {
        for (let x = bx; x < bx + blockW; x++) {
          const idx = (y * width + x) * channels;
          for (let c = 0; c < channels; c++) {
            dst[idx + c] = avg[c]!;
          }
        }
      }
    }
  }

  return { data: dst, width, height, channels };
}

registerFilterOp<PixelateParams>("cpu", "pixelate", (image, { blockSize }) => {
  return CpuImage.fromImageBinary(cpuPixelate((image as CpuImage).getBinary(), blockSize));
});
