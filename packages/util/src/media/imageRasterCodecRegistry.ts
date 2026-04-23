/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageBinary } from "./imageTypes";

export interface ImageRasterCodec {
  decodeDataUri(dataUri: string): Promise<ImageBinary>;
  encodeDataUri(image: ImageBinary, mimeType: string): Promise<string>;
}

let codec: ImageRasterCodec | null = null;

export function registerImageRasterCodec(next: ImageRasterCodec): void {
  codec = next;
}

export function getImageRasterCodec(): ImageRasterCodec {
  if (!codec) {
    throw new Error(
      "Image raster codec is not registered. Ensure you import @workglow/tasks from the browser or Node entry (dist/browser.js or dist/node.js), or call registerImageRasterCodec() during startup."
    );
  }
  return codec;
}
