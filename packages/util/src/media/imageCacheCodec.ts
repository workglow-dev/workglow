/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { registerPortCodec } from "@workglow/util";
import type { ImageValue } from "./imageValue";
import { isBrowserImageValue, isNodeImageValue } from "./imageValue";

/**
 * Cache codec for `format: "image"` ports. Round-trips ImageValue through
 * a structured-cloneable form. Bitmaps survive postMessage/transferList;
 * Buffers survive structured-clone in worker_threads.
 */
registerPortCodec<ImageValue, ImageValue>("image", {
  async serialize(value) {
    if (isBrowserImageValue(value) || isNodeImageValue(value)) {
      return value;
    }
    return value;
  },
  async deserialize(cached) {
    return cached;
  },
});
