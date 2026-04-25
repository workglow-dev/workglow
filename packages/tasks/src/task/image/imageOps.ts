/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-pixel image operations with paired GPU and CPU implementations. The
 * image tasks are thin wrappers that build the `params` object and call
 * `runImageOp(input.image, OP, params)` — the dispatcher chooses GPU when a
 * device is available and falls back to the CPU loop otherwise.
 *
 * The CPU paths preserve the prior in-task implementations (already
 * well-tuned: separable blur with running sums, LUT-based posterize /
 * contrast, etc.) so behavior remains identical when WebGPU isn't present.
 */

import type { ImageBinary, ImageChannels } from "@workglow/util/media";

import type { ImageOp, ImageOpResize } from "./imageOpDispatcher";

// --------------------------------------------------------------------------
// Lazy GPU runners — imported via dynamic `require`-style indirection so the
// node bundle for `@workglow/tasks` doesn't statically depend on the GPU
// shader module (which lives only in `@workglow/util/media`'s browser entry).
// --------------------------------------------------------------------------

interface GpuOpsApi {
  gpuSepia: (ctx: GpuCtx) => unknown;
  gpuInvert: (ctx: GpuCtx) => unknown;
  gpuGrayscale: (ctx: GpuCtx) => unknown;
  gpuFlipH: (ctx: GpuCtx) => unknown;
  gpuFlipV: (ctx: GpuCtx) => unknown;
  gpuBrightness: (ctx: GpuCtx, amount: number) => unknown;
  gpuContrast: (ctx: GpuCtx, factor: number) => unknown;
  gpuPosterize: (ctx: GpuCtx, levels: number) => unknown;
  gpuThreshold: (ctx: GpuCtx, threshold: number) => unknown;
  gpuTint: (ctx: GpuCtx, r: number, g: number, b: number, amount: number) => unknown;
  gpuTransparency: (ctx: GpuCtx, opacity: number) => unknown;
  gpuPixelate: (ctx: GpuCtx, blockSize: number) => unknown;
  gpuBlur: (ctx: GpuCtx, radius: number) => unknown;
}

interface GpuCtx {
  readonly device: unknown;
  readonly width: number;
  readonly height: number;
  readonly source: unknown;
}

let gpuApi: GpuOpsApi | null = null;
let gpuApiPromise: Promise<GpuOpsApi | null> | null = null;
async function getGpuApi(): Promise<GpuOpsApi | null> {
  if (gpuApi) return gpuApi;
  if (gpuApiPromise) return gpuApiPromise;
  gpuApiPromise = (async () => {
    try {
      const mod = (await import("@workglow/util/media")) as Partial<GpuOpsApi>;
      // The non-browser bundle of @workglow/util/media doesn't export these,
      // so any missing symbol means "GPU path not available on this platform".
      if (!mod.gpuSepia) return null;
      gpuApi = mod as GpuOpsApi;
      return gpuApi;
    } catch {
      return null;
    }
  })();
  return gpuApiPromise;
}

// Tasks call this synchronously after `await getGpuApi()` somewhere upstream.
function gpu(): GpuOpsApi | null {
  return gpuApi;
}

/**
 * Pre-warm the GPU module. Image tasks call this in `executeReactive` so the
 * synchronous `gpu()` lookup inside the op implementation is populated. The
 * await is cheap (just a cached module reference after the first call).
 */
export async function ensureImageGpuApi(): Promise<void> {
  await getGpuApi();
}

// --------------------------------------------------------------------------
// Op definitions
// --------------------------------------------------------------------------

export const SEPIA_OP: ImageOp<void> = {
  gpu: (source, ctx) => {
    const api = gpu();
    return api ? api.gpuSepia({ ...ctx, source }) : null;
  },
  cpu: (img) => {
    const { data: src, width, height, channels } = img;
    const dst = new Uint8ClampedArray(src.length);
    const pixelCount = width * height;
    for (let i = 0; i < pixelCount; i++) {
      const idx = i * channels;
      const r = src[idx]!;
      const g = channels === 1 ? r : src[idx + 1]!;
      const b = channels === 1 ? r : src[idx + 2]!;
      const outR = (r * 402 + g * 787 + b * 194) >> 10;
      const outG = (r * 357 + g * 702 + b * 172) >> 10;
      const outB = (r * 279 + g * 547 + b * 134) >> 10;
      dst[idx] = outR > 255 ? 255 : outR;
      if (channels >= 3) {
        dst[idx + 1] = outG > 255 ? 255 : outG;
        dst[idx + 2] = outB > 255 ? 255 : outB;
      }
      if (channels === 4) {
        dst[idx + 3] = src[idx + 3]!;
      }
    }
    return { data: dst, width, height, channels };
  },
};

export const INVERT_OP: ImageOp<void> = {
  gpu: (source, ctx) => (gpu() ? gpu()!.gpuInvert({ ...ctx, source }) : null),
  cpu: (img) => {
    const { data: src, width, height, channels } = img;
    const dst = new Uint8ClampedArray(src.length);
    if (channels === 4) {
      for (let i = 0; i < src.length; i += 4) {
        dst[i] = 255 - src[i]!;
        dst[i + 1] = 255 - src[i + 1]!;
        dst[i + 2] = 255 - src[i + 2]!;
        dst[i + 3] = src[i + 3]!;
      }
    } else {
      for (let i = 0; i < src.length; i++) dst[i] = 255 - src[i]!;
    }
    return { data: dst, width, height, channels };
  },
};

export const GRAYSCALE_OP: ImageOp<void> = {
  gpu: (source, ctx) => (gpu() ? gpu()!.gpuGrayscale({ ...ctx, source }) : null),
  cpu: (img) => {
    const { data: src, width, height, channels } = img;
    if (channels === 1) {
      return { data: new Uint8ClampedArray(src), width, height, channels: 1 };
    }
    const pixelCount = width * height;
    const dst = new Uint8ClampedArray(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      const idx = i * channels;
      dst[i] = (src[idx]! * 77 + src[idx + 1]! * 150 + src[idx + 2]! * 29) >> 8;
    }
    return { data: dst, width, height, channels: 1 };
  },
};

export const BRIGHTNESS_OP: ImageOp<{ amount: number }> = {
  gpu: (source, ctx, p) =>
    gpu() ? gpu()!.gpuBrightness({ ...ctx, source }, p.amount / 255) : null,
  cpu: (img, p) => {
    const { data: src, width, height, channels } = img;
    const dst = new Uint8ClampedArray(src.length);
    const a = p.amount;
    if (channels === 4) {
      for (let i = 0; i < src.length; i += 4) {
        dst[i] = src[i]! + a;
        dst[i + 1] = src[i + 1]! + a;
        dst[i + 2] = src[i + 2]! + a;
        dst[i + 3] = src[i + 3]!;
      }
    } else {
      for (let i = 0; i < src.length; i++) dst[i] = src[i]! + a;
    }
    return { data: dst, width, height, channels };
  },
};

export const CONTRAST_OP: ImageOp<{ amount: number }> = {
  gpu: (source, ctx, p) => {
    const factor = (259 * (p.amount + 255)) / (255 * (259 - p.amount));
    return gpu() ? gpu()!.gpuContrast({ ...ctx, source }, factor) : null;
  },
  cpu: (img, p) => {
    const { data: src, width, height, channels } = img;
    const factor = (259 * (p.amount + 255)) / (255 * (259 - p.amount));
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = factor * (i - 128) + 128;
    const dst = new Uint8ClampedArray(src.length);
    if (channels === 4) {
      for (let i = 0; i < src.length; i += 4) {
        dst[i] = lut[src[i]!]!;
        dst[i + 1] = lut[src[i + 1]!]!;
        dst[i + 2] = lut[src[i + 2]!]!;
        dst[i + 3] = src[i + 3]!;
      }
    } else {
      for (let i = 0; i < src.length; i++) dst[i] = lut[src[i]!]!;
    }
    return { data: dst, width, height, channels };
  },
};

export const POSTERIZE_OP: ImageOp<{ levels: number }> = {
  gpu: (source, ctx, p) => (gpu() ? gpu()!.gpuPosterize({ ...ctx, source }, p.levels) : null),
  cpu: (img, p) => {
    const { data: src, width, height, channels } = img;
    const step = 255 / (p.levels - 1);
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = Math.round(Math.round(i / step) * step);
    const dst = new Uint8ClampedArray(src.length);
    if (channels === 4) {
      for (let i = 0; i < src.length; i += 4) {
        dst[i] = lut[src[i]!]!;
        dst[i + 1] = lut[src[i + 1]!]!;
        dst[i + 2] = lut[src[i + 2]!]!;
        dst[i + 3] = src[i + 3]!;
      }
    } else {
      for (let i = 0; i < src.length; i++) dst[i] = lut[src[i]!]!;
    }
    return { data: dst, width, height, channels };
  },
};

export const THRESHOLD_OP: ImageOp<{ threshold: number }> = {
  gpu: (source, ctx, p) =>
    gpu() ? gpu()!.gpuThreshold({ ...ctx, source }, p.threshold / 255) : null,
  cpu: (img, p) => {
    const { data: src, width, height, channels } = img;
    const pixelCount = width * height;
    const dst = new Uint8ClampedArray(pixelCount);
    const t = p.threshold;
    for (let i = 0; i < pixelCount; i++) {
      const idx = i * channels;
      const gray =
        channels === 1
          ? src[idx]!
          : (src[idx]! * 77 + src[idx + 1]! * 150 + src[idx + 2]! * 29) >> 8;
      dst[i] = gray >= t ? 255 : 0;
    }
    return { data: dst, width, height, channels: 1 };
  },
};

export const TINT_OP: ImageOp<{
  r: number;
  g: number;
  b: number;
  amount: number;
}> = {
  gpu: (source, ctx, p) =>
    gpu()
      ? gpu()!.gpuTint({ ...ctx, source }, p.r / 255, p.g / 255, p.b / 255, p.amount)
      : null,
  cpu: (img, p) => {
    const { data: src, width, height, channels } = img;
    const pixelCount = width * height;
    const inv = 1 - p.amount;
    const tr = p.r * p.amount;
    const tg = p.g * p.amount;
    const tb = p.b * p.amount;
    if (channels === 1) {
      const dst = new Uint8ClampedArray(pixelCount * 3);
      for (let i = 0; i < pixelCount; i++) {
        const v = src[i]!;
        dst[i * 3] = v * inv + tr;
        dst[i * 3 + 1] = v * inv + tg;
        dst[i * 3 + 2] = v * inv + tb;
      }
      return { data: dst, width, height, channels: 3 };
    }
    const dst = new Uint8ClampedArray(src.length);
    for (let i = 0; i < pixelCount; i++) {
      const idx = i * channels;
      dst[idx] = src[idx]! * inv + tr;
      dst[idx + 1] = src[idx + 1]! * inv + tg;
      dst[idx + 2] = src[idx + 2]! * inv + tb;
      if (channels === 4) dst[idx + 3] = src[idx + 3]!;
    }
    return { data: dst, width, height, channels };
  },
};

export const TRANSPARENCY_OP: ImageOp<{ opacity: number }> = {
  gpu: (source, ctx, p) =>
    gpu() ? gpu()!.gpuTransparency({ ...ctx, source }, p.opacity) : null,
  cpu: (img, p) => {
    const { data: src, width, height, channels: srcCh } = img;
    const pixelCount = width * height;
    const dst = new Uint8ClampedArray(pixelCount * 4);
    const alphaScale = Math.round(p.opacity * 255);
    for (let i = 0; i < pixelCount; i++) {
      const srcIdx = i * srcCh;
      const dstIdx = i * 4;
      const r = src[srcIdx]!;
      dst[dstIdx] = r;
      dst[dstIdx + 1] = srcCh >= 3 ? src[srcIdx + 1]! : r;
      dst[dstIdx + 2] = srcCh >= 3 ? src[srcIdx + 2]! : r;
      const srcAlpha = srcCh === 4 ? src[srcIdx + 3]! : 255;
      dst[dstIdx + 3] = (srcAlpha * alphaScale + 127) / 255;
    }
    return { data: dst, width, height, channels: 4 };
  },
};

export const PIXELATE_OP: ImageOp<{ blockSize: number }> = {
  gpu: (source, ctx, p) =>
    gpu() ? gpu()!.gpuPixelate({ ...ctx, source }, p.blockSize) : null,
  cpu: (img, p) => {
    const { data: src, width, height, channels } = img;
    const dst = new Uint8ClampedArray(src.length);
    const blockSize = p.blockSize;
    for (let by = 0; by < height; by += blockSize) {
      const blockH = Math.min(blockSize, height - by);
      for (let bx = 0; bx < width; bx += blockSize) {
        const blockW = Math.min(blockSize, width - bx);
        const blockArea = blockW * blockH;
        const sums = new Array<number>(channels).fill(0);
        for (let y = by; y < by + blockH; y++) {
          for (let x = bx; x < bx + blockW; x++) {
            const idx = (y * width + x) * channels;
            for (let c = 0; c < channels; c++) sums[c] += src[idx + c]!;
          }
        }
        const avg = sums.map((s) => (s / blockArea + 0.5) | 0);
        for (let y = by; y < by + blockH; y++) {
          for (let x = bx; x < bx + blockW; x++) {
            const idx = (y * width + x) * channels;
            for (let c = 0; c < channels; c++) dst[idx + c] = avg[c]!;
          }
        }
      }
    }
    return { data: dst, width, height, channels };
  },
};

export const BLUR_OP: ImageOp<{ radius: number }> = {
  gpu: (source, ctx, p) => (gpu() ? gpu()!.gpuBlur({ ...ctx, source }, p.radius) : null),
  cpu: (img, p) => {
    const { data: src, width, height, channels } = img;
    const radius = p.radius;
    const kernelSize = radius * 2 + 1;
    const tmp = new Uint8ClampedArray(src.length);
    for (let y = 0; y < height; y++) {
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const x = Math.max(0, Math.min(k, width - 1));
          sum += src[(y * width + x) * channels + c]!;
        }
        tmp[y * width * channels + c] = (sum / kernelSize + 0.5) | 0;
        for (let x = 1; x < width; x++) {
          const addX = Math.min(x + radius, width - 1);
          const removeX = Math.max(x - radius - 1, 0);
          sum +=
            src[(y * width + addX) * channels + c]! -
            src[(y * width + removeX) * channels + c]!;
          tmp[(y * width + x) * channels + c] = (sum / kernelSize + 0.5) | 0;
        }
      }
    }
    const dst = new Uint8ClampedArray(src.length);
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const y = Math.max(0, Math.min(k, height - 1));
          sum += tmp[(y * width + x) * channels + c]!;
        }
        dst[x * channels + c] = (sum / kernelSize + 0.5) | 0;
        for (let y = 1; y < height; y++) {
          const addY = Math.min(y + radius, height - 1);
          const removeY = Math.max(y - radius - 1, 0);
          sum +=
            tmp[(addY * width + x) * channels + c]! -
            tmp[(removeY * width + x) * channels + c]!;
          dst[(y * width + x) * channels + c] = (sum / kernelSize + 0.5) | 0;
        }
      }
    }
    return { data: dst, width, height, channels };
  },
};

export const FLIP_OP: ImageOp<{ direction: "horizontal" | "vertical" }> = {
  gpu: (source, ctx, p) =>
    gpu()
      ? p.direction === "horizontal"
        ? gpu()!.gpuFlipH({ ...ctx, source })
        : gpu()!.gpuFlipV({ ...ctx, source })
      : null,
  cpu: (img, p) => {
    const { data: src, width, height, channels } = img;
    const dst = new Uint8ClampedArray(src.length);
    const rowBytes = width * channels;
    if (p.direction === "vertical") {
      for (let y = 0; y < height; y++) {
        const srcOffset = y * rowBytes;
        const dstOffset = (height - 1 - y) * rowBytes;
        dst.set(src.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
      }
    } else {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const srcIdx = (y * width + x) * channels;
          const dstIdx = (y * width + (width - 1 - x)) * channels;
          for (let c = 0; c < channels; c++) dst[dstIdx + c] = src[srcIdx + c]!;
        }
      }
    }
    return { data: dst, width, height, channels };
  },
};

// Border / Rotate / Crop / Resize change output dimensions; they always go
// through the CPU helpers (the GPU wins less here — these ops are O(N) data
// movement, which the CPU can stride very efficiently). They share the same
// dispatcher entry point via `runImageResizeOp` so future GPU impls can drop
// in without touching the call sites.

export const BORDER_OP: ImageOpResize<{
  borderWidth: number;
  r: number;
  g: number;
  b: number;
  a: number;
}> = {
  cpu: (img, p) => {
    const { data: src, width: srcW, height: srcH, channels: srcCh } = img;
    const bw = p.borderWidth;
    const outCh: ImageChannels = 4;
    const dstW = srcW + bw * 2;
    const dstH = srcH + bw * 2;
    const dst = new Uint8ClampedArray(dstW * dstH * outCh);
    for (let i = 0; i < dst.length; i += outCh) {
      dst[i] = p.r;
      dst[i + 1] = p.g;
      dst[i + 2] = p.b;
      dst[i + 3] = p.a;
    }
    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        const srcIdx = (y * srcW + x) * srcCh;
        const dstIdx = ((y + bw) * dstW + (x + bw)) * outCh;
        const r = src[srcIdx]!;
        dst[dstIdx] = r;
        dst[dstIdx + 1] = srcCh >= 3 ? src[srcIdx + 1]! : r;
        dst[dstIdx + 2] = srcCh >= 3 ? src[srcIdx + 2]! : r;
        dst[dstIdx + 3] = srcCh === 4 ? src[srcIdx + 3]! : 255;
      }
    }
    return { data: dst, width: dstW, height: dstH, channels: outCh };
  },
};

export const ROTATE_OP: ImageOpResize<{ angle: 90 | 180 | 270 }> = {
  cpu: (img, p) => {
    const { data: src, width: srcW, height: srcH, channels } = img;
    const swap = p.angle === 90 || p.angle === 270;
    const dstW = swap ? srcH : srcW;
    const dstH = swap ? srcW : srcH;
    const dst = new Uint8ClampedArray(dstW * dstH * channels);
    for (let sy = 0; sy < srcH; sy++) {
      for (let sx = 0; sx < srcW; sx++) {
        let dx: number;
        let dy: number;
        if (p.angle === 90) {
          dx = srcH - 1 - sy;
          dy = sx;
        } else if (p.angle === 180) {
          dx = srcW - 1 - sx;
          dy = srcH - 1 - sy;
        } else {
          dx = sy;
          dy = srcW - 1 - sx;
        }
        const srcIdx = (sy * srcW + sx) * channels;
        const dstIdx = (dy * dstW + dx) * channels;
        for (let c = 0; c < channels; c++) dst[dstIdx + c] = src[srcIdx + c]!;
      }
    }
    return { data: dst, width: dstW, height: dstH, channels };
  },
};

export const CROP_OP: ImageOpResize<{ x: number; y: number; width: number; height: number }> = {
  cpu: (img, p) => {
    const { data: src, width: srcW, height: srcH, channels } = img;
    if (srcW < 1 || srcH < 1) throw new RangeError("Cannot crop an empty image");
    if (p.x < 0 || p.x >= srcW || p.y < 0 || p.y >= srcH) {
      throw new RangeError("Crop origin is outside the source image bounds");
    }
    const w = Math.min(p.width, srcW - p.x);
    const h = Math.min(p.height, srcH - p.y);
    const dst = new Uint8ClampedArray(w * h * channels);
    const rowBytes = w * channels;
    for (let row = 0; row < h; row++) {
      const srcOffset = ((p.y + row) * srcW + p.x) * channels;
      const dstOffset = row * rowBytes;
      dst.set(src.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
    }
    return { data: dst, width: w, height: h, channels };
  },
};

export const RESIZE_OP: ImageOpResize<{ width: number; height: number }> = {
  cpu: (img, p) => {
    const { data: src, width: srcW, height: srcH, channels } = img;
    const dstW = p.width;
    const dstH = p.height;
    const dst = new Uint8ClampedArray(dstW * dstH * channels);
    for (let dy = 0; dy < dstH; dy++) {
      const srcY = Math.min(Math.floor((dy * srcH) / dstH), srcH - 1);
      for (let dx = 0; dx < dstW; dx++) {
        const srcX = Math.min(Math.floor((dx * srcW) / dstW), srcW - 1);
        const srcIdx = (srcY * srcW + srcX) * channels;
        const dstIdx = (dy * dstW + dx) * channels;
        for (let c = 0; c < channels; c++) dst[dstIdx + c] = src[srcIdx + c]!;
      }
    }
    return { data: dst, width: dstW, height: dstH, channels };
  },
};

export type ImageBinarySrc = ImageBinary;
