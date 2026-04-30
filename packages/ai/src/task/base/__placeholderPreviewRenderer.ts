/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageValue, RawPixelBuffer } from "@workglow/util/media";
import { CpuImage } from "@workglow/util/media";

const PLACEHOLDER_WIDTH = 256;
const PLACEHOLDER_HEIGHT = 256;

/**
 * Synthesizes a small RawPixelBuffer for use as a graph-editor placeholder
 * before any partial image has arrived. The data is a flat dark-gray fill
 * (no text rendering — text rendering is platform-specific and not worth
 * pulling in here). Tasks that want a richer placeholder can override
 * renderPlaceholderPreview() in their subclass.
 */
export function buildPlaceholderRawPixelBuffer(): RawPixelBuffer {
  const data = new Uint8ClampedArray(PLACEHOLDER_WIDTH * PLACEHOLDER_HEIGHT * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 32;
    data[i + 1] = 32;
    data[i + 2] = 32;
    data[i + 3] = 255;
  }
  return { data, width: PLACEHOLDER_WIDTH, height: PLACEHOLDER_HEIGHT, channels: 4 };
}

/**
 * Builds a placeholder ImageValue suitable for executePreview() output.
 * Uses CpuImage.fromRaw() + toImageValue() so the result is a plain POJO
 * (BrowserImageValue with ImageBitmap, or NodeImageValue with raw-rgba Buffer)
 * that survives the structured-clone boundary.
 */
export async function buildPlaceholderImageValue(): Promise<ImageValue> {
  const cpu = CpuImage.fromRaw(buildPlaceholderRawPixelBuffer());
  return cpu.toImageValue(1);
}
