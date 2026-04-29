/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { CpuImage, type ImageBinary } from "@workglow/util/media";
import { registerFilterOp } from "../imageOp";

export interface ResizeParams { width: number; height: number; fit?: string; kernel?: string; }

function cpuResize(bin: ImageBinary, dstW: number, dstH: number): ImageBinary {
  const { data: src, width: srcW, height: srcH, channels } = bin;
  const dst = new Uint8ClampedArray(dstW * dstH * channels);

  for (let dy = 0; dy < dstH; dy++) {
    const srcY = Math.min(Math.floor((dy * srcH) / dstH), srcH - 1);
    for (let dx = 0; dx < dstW; dx++) {
      const srcX = Math.min(Math.floor((dx * srcW) / dstW), srcW - 1);
      const srcIdx = (srcY * srcW + srcX) * channels;
      const dstIdx = (dy * dstW + dx) * channels;
      for (let c = 0; c < channels; c++) {
        dst[dstIdx + c] = src[srcIdx + c]!;
      }
    }
  }

  return { data: dst, width: dstW, height: dstH, channels };
}

registerFilterOp<ResizeParams>("cpu", "resize", (image, { width, height }) => {
  return CpuImage.fromImageBinary(cpuResize((image as CpuImage).getBinary(), width, height));
});
