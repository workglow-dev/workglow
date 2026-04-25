/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageBinary } from "@workglow/util/media";
import { Image, getImageRasterCodec } from "@workglow/util/media";

/**
 * Decode the input to pixels via the unified {@link Image} class, run `run`,
 * then return output in the same wire form as the input:
 *
 * - data URI string in → data URI string out (re-encoded with input MIME),
 * - `ImageBinary` in → `ImageBinary` out.
 *
 * The legacy wire format is preserved so existing task graphs and caches
 * keep working; `Image` is used internally to funnel decode/encode through
 * the single raster-codec registry.
 */
export async function produceImageOutput(
  inputImage: Image | ImageBinary | string,
  run: (image: ImageBinary) => ImageBinary | Promise<ImageBinary>
): Promise<ImageBinary | string> {
  const image = Image.is(inputImage) ? inputImage : Image.from(inputImage);
  const pixels = await image.getPixels();
  const out = await run(pixels);
  if (image.kind === "dataUri") {
    const mime = image.mimeType ?? "image/png";
    return getImageRasterCodec().encodeDataUri(out, mime);
  }
  return out;
}
