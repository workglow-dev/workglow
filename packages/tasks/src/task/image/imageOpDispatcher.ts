/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Central image-op dispatcher: routes a task's per-op work to a WebGPU
 * compute pipeline when available, or a CPU fallback otherwise.
 *
 * Tasks declare *both* implementations; the dispatcher decides. Output is an
 * `Image` (so a chain of GPU tasks can pass `GPUTexture` along without
 * intermediate readback) — `produceImageOutput` materializes pixels at the
 * boundary when a downstream consumer needs them.
 */

import { Image, type ImageBinary } from "@workglow/util/media";

/**
 * Result of a task's image op. Tasks return either an `ImageBinary` (CPU
 * computed) or an `unknown` GPU texture (the dispatcher already knows the
 * width/height because it uploaded the input).
 */
export type ImageOpResult =
  | { readonly kind: "pixels"; readonly pixels: ImageBinary }
  | {
      readonly kind: "texture";
      readonly texture: unknown;
      readonly width: number;
      readonly height: number;
    };

export interface ImageOpRunContext {
  /** GPU device, if available. */
  readonly device: unknown | null;
  /** Input image dimensions (post-upload, in pixels). */
  readonly width: number;
  readonly height: number;
}

export interface ImageOp<P> {
  /**
   * Cheap GPU implementation. Returns the output texture (allocated by the op
   * via `createImageGpuTexture` or `runUnary` helpers in `imageGpuOps`). Tasks
   * may return null if they want to fall back to CPU for some reason.
   */
  readonly gpu?:
    | ((sourceTexture: unknown, ctx: ImageOpRunContext, params: P) => unknown | null)
    | undefined;
  /** Pure-JS fallback. Always provided so node and GPU-less browsers work. */
  readonly cpu: (input: ImageBinary, params: P) => ImageBinary;
}

let gpuDevicePromise: Promise<unknown | null> | null = null;
async function ensureGpuDevice(): Promise<unknown | null> {
  if (typeof navigator === "undefined") return null;
  // Lazy import so node bundles don't drag in the GPU module.
  if (!gpuDevicePromise) {
    gpuDevicePromise = (async () => {
      try {
        const mod = await import("@workglow/util/media");
        const dev = await (mod as { getImageGpuDevice?: () => Promise<unknown | null> })
          .getImageGpuDevice?.();
        return dev ?? null;
      } catch {
        return null;
      }
    })();
  }
  return gpuDevicePromise;
}

/**
 * Run an `ImageOp` with the given input and params, returning an `Image`.
 * - If GPU is available *and* the op declares a `gpu` impl, runs on GPU and
 *   wraps the resulting texture in `Image.fromTexture(...)`.
 * - Otherwise materializes pixels (decoding dataUri once, etc.) and runs CPU.
 *
 * Inputs that are already GPU-resident skip the upload step.
 */
export async function runImageOp<P>(
  input: Image | ImageBinary | string,
  op: ImageOp<P>,
  params: P
): Promise<Image> {
  const image = Image.is(input) ? input : Image.from(input);

  if (op.gpu) {
    const device = await ensureGpuDevice();
    if (device) {
      // Pull dimensions before getTexture(): getTexture() may need to
      // download/upload pixels, but width/height are known on every source
      // kind we accept (texture / pixels / dataUri / blob / bitmap / etc).
      const w = image.width;
      const h = image.height;
      if (typeof w === "number" && typeof h === "number") {
        const sourceTexture = await (image as unknown as {
          getTexture: () => Promise<unknown>;
        }).getTexture();
        const out = op.gpu(sourceTexture, { device, width: w, height: h }, params);
        if (out) {
          return Image.fromTexture(out, w, h);
        }
      }
    }
  }

  const pixels = await image.getPixels();
  const result = op.cpu(pixels, params);
  return Image.fromPixels(result);
}

/**
 * Like {@link runImageOp} but for ops where input *and* output dimensions can
 * differ (border, rotate, resize, crop). The GPU impl returns a full
 * `ImageOpResult` so it can declare its own output size; the CPU impl returns
 * the resulting `ImageBinary` directly.
 */
export interface ImageOpResize<P> {
  readonly gpu?:
    | ((
        sourceTexture: unknown,
        ctx: ImageOpRunContext,
        params: P
      ) => ImageOpResult | null)
    | undefined;
  readonly cpu: (input: ImageBinary, params: P) => ImageBinary;
}

export async function runImageResizeOp<P>(
  input: Image | ImageBinary | string,
  op: ImageOpResize<P>,
  params: P
): Promise<Image> {
  const image = Image.is(input) ? input : Image.from(input);
  if (op.gpu) {
    const device = await ensureGpuDevice();
    if (device) {
      const w = image.width;
      const h = image.height;
      if (typeof w === "number" && typeof h === "number") {
        const sourceTexture = await (image as unknown as {
          getTexture: () => Promise<unknown>;
        }).getTexture();
        const out = op.gpu(sourceTexture, { device, width: w, height: h }, params);
        if (out) {
          return out.kind === "texture"
            ? Image.fromTexture(out.texture, out.width, out.height)
            : Image.fromPixels(out.pixels);
        }
      }
    }
  }
  const pixels = await image.getPixels();
  const result = op.cpu(pixels, params);
  return Image.fromPixels(result);
}
