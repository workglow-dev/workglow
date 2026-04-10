/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageBinary } from "@workglow/util/media";

import { formatImageOutput, resolveImageInput } from "./imageTaskTransport";

/**
 * Decode {@link ImageBinary} or data URI to a raster, run pixel work, then re-encode to a data URI
 * when the input was a data URI (same MIME as the input, when supported).
 */
export async function produceImageOutput(
  inputImage: ImageBinary | string,
  run: (image: ImageBinary) => ImageBinary | Promise<ImageBinary>
): Promise<ImageBinary | string> {
  const { raster, transport } = await resolveImageInput(inputImage);
  const outRaster = await run(raster);
  return formatImageOutput(outRaster, transport);
}
