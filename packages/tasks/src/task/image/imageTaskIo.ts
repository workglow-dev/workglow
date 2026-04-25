/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageBinary } from "@workglow/util/media";
import { Image } from "@workglow/util/media";

/**
 * Decode the input to pixels via the unified {@link Image} class, run `run`,
 * and return the result as a pixel buffer (`ImageBinary`).
 *
 * Earlier revisions of this helper re-encoded a dataUri output to base64 to
 * "match input form" — that round-trip costs hundreds of milliseconds per
 * task in a chained pipeline (`canvas.convertToBlob` + chunked `btoa` on the
 * way out, `createImageBitmap` + `getImageData` on the way into the next
 * task). For reactive previews the dataUri form is only useful at the
 * pipeline edge (display / persistence), so we keep pixels flowing inside
 * the chain and let the consumer encode lazily.
 */
export async function produceImageOutput(
  inputImage: Image | ImageBinary | string,
  run: (image: ImageBinary) => ImageBinary | Promise<ImageBinary>
): Promise<ImageBinary> {
  const image = Image.is(inputImage) ? inputImage : Image.from(inputImage);
  const pixels = await image.getPixels();
  return await run(pixels);
}

/**
 * GPU-aware variant. If the input is GPU-resident (or the platform has GPU
 * available) the caller's `runGpu` runs against the upstream texture and
 * returns the new texture wrapped in an {@link Image}. Otherwise this falls
 * back to the CPU path via `runCpu`.
 *
 * Returning `Image` (instead of `ImageBinary`) lets a chain of GPU-using
 * tasks pass textures along without intermediate readback. The wire format
 * remains compatible because the schema accepts `oneOf: [ImageBinary,
 * dataUri]` and `Image` instances pass through `Image.from()` unchanged.
 */
export async function produceImageOutputAware(
  inputImage: Image | ImageBinary | string,
  runCpu: (image: ImageBinary) => ImageBinary | Promise<ImageBinary>,
  runGpu?: (
    sourceTexture: unknown,
    ctx: { readonly device: unknown; readonly width: number; readonly height: number }
  ) => unknown | null
): Promise<Image> {
  const image = Image.is(inputImage) ? inputImage : Image.from(inputImage);
  if (runGpu && typeof navigator !== "undefined") {
    try {
      // Dynamic import to avoid pulling the GPU module into node bundles.
      const mod = await import("@workglow/util/media");
      const getDev = (mod as { getImageGpuDevice?: () => Promise<unknown | null> })
        .getImageGpuDevice;
      if (getDev) {
        const device = await getDev();
        if (device) {
          const w = image.width;
          const h = image.height;
          if (typeof w === "number" && typeof h === "number") {
            const tex = await (image as unknown as {
              getTexture: () => Promise<unknown>;
            }).getTexture();
            const out = runGpu(tex, { device, width: w, height: h });
            if (out) {
              return Image.fromTexture(out, w, h);
            }
          }
        }
      }
    } catch {
      // Fall through to CPU path on any GPU failure.
    }
  }
  const pixels = await image.getPixels();
  const result = await runCpu(pixels);
  return Image.fromPixels(result);
}
